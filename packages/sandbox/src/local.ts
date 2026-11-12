import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitProjectStore } from '@mya/codegen';
import { ALLOWED_COMMANDS, DEFAULT_LIMITS, type CommandResult, type SandboxLimits, type SandboxProvider, type SandboxSession } from './types.js';

/**
 * DEVELOPMENT-ONLY sandbox: runs commands as child processes in a throwaway directory with
 * a scrubbed environment, an executable allow-list, prlimit resource caps and a wall-clock timeout.
 * It does NOT provide kernel-level isolation or network egress control — use the container
 * provider in production (`productionGrade = false` makes the API refuse it when NODE_ENV=production).
 */
export class LocalProcessSandbox implements SandboxProvider {
  readonly name = 'local-process';
  readonly productionGrade = false;

  constructor(private readonly opts: { baseDir?: string; npmCacheDir?: string } = {}) {}

  async create(): Promise<SandboxSession> {
    const workdir = await mkdtemp(path.join(this.opts.baseDir ?? tmpdir(), 'mya-sbx-'));
    return new LocalSession(randomUUID(), workdir, this.opts.npmCacheDir);
  }
}

class LocalSession implements SandboxSession {
  constructor(
    readonly id: string,
    readonly workdir: string,
    private readonly npmCacheDir?: string,
  ) {}

  writeFiles(files: Map<string, string>) {
    return GitProjectStore.materialize(files, this.workdir);
  }

  run(cmd: string[], o: Partial<SandboxLimits> & { onOutput?: (c: string) => void } = {}): Promise<CommandResult> {
    const limits = { ...DEFAULT_LIMITS, ...o };
    const [exe, ...args] = cmd;
    if (!exe || !ALLOWED_COMMANDS.has(exe)) return Promise.reject(new Error(`Command not allowed in sandbox: ${exe}`));
    // Scrubbed environment: no platform secrets ever reach generated code.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'],
      HOME: this.workdir,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      CI: '1',
      npm_config_cache: this.npmCacheDir ?? path.join(this.workdir, '.npm-cache'),
      npm_config_update_notifier: 'false',
      ...(process.env['HTTPS_PROXY'] ? { HTTPS_PROXY: process.env['HTTPS_PROXY'], HTTP_PROXY: process.env['HTTP_PROXY'] } : {}),
      ...(process.env['NODE_EXTRA_CA_CERTS'] ? { NODE_EXTRA_CA_CERTS: process.env['NODE_EXTRA_CA_CERTS'] } : {}),
      ...(process.env['SSL_CERT_FILE'] ? { SSL_CERT_FILE: process.env['SSL_CERT_FILE'] } : {}),
    };
    const wrapped = ['prlimit', `--nproc=${limits.maxProcs}`, `--fsize=${limits.maxFileBytes}`, `--cpu=${limits.cpuSeconds}`, '--', exe, ...args];
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(wrapped[0]!, wrapped.slice(1), { cwd: this.workdir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let timedOut = false;
      const onData = (b: Buffer) => {
        const s = b.toString();
        o.onOutput?.(s);
        if (output.length < limits.maxOutputBytes) output += s.slice(0, limits.maxOutputBytes - output.length);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, 'SIGKILL'); // kill the whole process group
        } catch {
          /* already exited */
        }
      }, limits.timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ cmd, exitCode: code, timedOut, durationMs: Date.now() - started, output });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ cmd, exitCode: -1, timedOut, durationMs: Date.now() - started, output: output + String(err) });
      });
    });
  }

  async dispose() {
    await rm(this.workdir, { recursive: true, force: true });
  }
}
