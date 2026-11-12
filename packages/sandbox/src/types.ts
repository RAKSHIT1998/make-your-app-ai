export interface CommandResult {
  cmd: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** Combined stdout/stderr, truncated to the configured cap. */
  output: string;
}

export interface SandboxLimits {
  timeoutMs: number;
  maxOutputBytes: number;
  /** Max processes for the sandboxed command tree. */
  maxProcs: number;
  /** Max size of any single written file, bytes. */
  maxFileBytes: number;
  /** CPU seconds. */
  cpuSeconds: number;
}

export interface SandboxSession {
  readonly id: string;
  readonly workdir: string;
  writeFiles(files: Map<string, string>): Promise<void>;
  run(cmd: string[], opts?: Partial<SandboxLimits> & { onOutput?: (chunk: string) => void; network?: boolean }): Promise<CommandResult>;
  dispose(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  /** Whether this provider isolates untrusted code strongly enough for production. */
  readonly productionGrade: boolean;
  create(opts: { projectId: string }): Promise<SandboxSession>;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: 5 * 60_000,
  maxOutputBytes: 200_000,
  maxProcs: 256,
  maxFileBytes: 512 * 1024 * 1024,
  cpuSeconds: 600,
};

/** Only these executables may be launched inside a sandbox. */
export const ALLOWED_COMMANDS = new Set(['npm', 'npx', 'node', 'pnpm']);
