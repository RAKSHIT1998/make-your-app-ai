import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitProjectStore } from '@mya/codegen';
import { ALLOWED_COMMANDS, DEFAULT_LIMITS, type CommandResult, type SandboxLimits, type SandboxProvider, type SandboxSession } from './types.js';

export interface DockerSandboxOptions {
  image: string; // e.g. node:22-bookworm-slim
  memory: string; // e.g. "2g"
  cpus: string; // e.g. "2"
  /** Docker network used when a command needs registry access (install). Must be egress-filtered to package registries. */
  installNetwork: string;
}

/**
 * Container sandbox: each command runs in a fresh container with no capabilities, a read-only root FS,
 * CPU/memory/PID limits, and no network unless `network: true` (install step only, on a filtered network).
 * STATUS: implemented but not yet exercised in CI — the build environment has no Docker daemon.
 */
export class DockerSandbox implements SandboxProvider {
  readonly name = 'docker';
  readonly productionGrade = true;
  constructor(private readonly o: DockerSandboxOptions) {}

  async create(): Promise<SandboxSession> {
    const workdir = await mkdtemp(path.join(tmpdir(), 'mya-dsbx-'));
    return new DockerSession(randomUUID(), workdir, this.o);
  }
}

class DockerSession implements SandboxSession {
  constructor(
    readonly id: string,
    readonly workdir: string,
    private readonly o: DockerSandboxOptions,
  ) {}

  writeFiles(files: Map<string, string>) {
    return GitProjectStore.materialize(files, this.workdir);
  }

  run(cmd: string[], opts: Partial<SandboxLimits> & { onOutput?: (c: string) => void; network?: boolean } = {}): Promise<CommandResult> {
    const limits = { ...DEFAULT_LIMITS, ...opts };
    if (!cmd[0] || !ALLOWED_COMMANDS.has(cmd[0])) return Promise.reject(new Error(`Command not allowed in sandbox: ${cmd[0]}`));
    const name = `mya-${this.id.slice(0, 8)}-${Date.now()}`;
    const args = [
      'run', '--rm', '--name', name,
      '--network', opts.network ? this.o.installNetwork : 'none',
      '--memory', this.o.memory, '--cpus', this.o.cpus, '--pids-limit', String(limits.maxProcs),
      '--read-only', '--tmpfs', '/tmp:rw,size=512m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--user', '1000:1000', '-e', 'HOME=/work', '-e', 'CI=1', '-e', 'NEXT_TELEMETRY_DISABLED=1',
      '-v', `${this.workdir}:/work:rw`, '-w', '/work',
      this.o.image, ...cmd,
    ];
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let timedOut = false;
      const onData = (b: Buffer) => {
        const s = b.toString();
        opts.onOutput?.(s);
        if (output.length < limits.maxOutputBytes) output += s.slice(0, limits.maxOutputBytes - output.length);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      const timer = setTimeout(() => {
        timedOut = true;
        spawn('docker', ['kill', name]);
      }, limits.timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ cmd, exitCode: code, timedOut, durationMs: Date.now() - started, output });
      });
    });
  }

  async dispose() {
    await rm(this.workdir, { recursive: true, force: true });
  }
}
