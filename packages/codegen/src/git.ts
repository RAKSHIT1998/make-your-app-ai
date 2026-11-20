import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { safePath, type FileTree } from './patch.js';

const run = promisify(execFile);

/**
 * Somewhere durable to keep a copy of each project's repository (a git bundle), so the local
 * directory is only a cache: hosts without a persistent disk, new instances and restarts restore
 * from the mirror on first use.
 */
export interface RepoMirror {
  /** HEAD commit of the stored copy, or null when there is none. Called on every access, so keep it cheap. */
  head(projectId: string): Promise<string | null>;
  load(projectId: string): Promise<Buffer | null>;
  save(projectId: string, head: string, bundle: Buffer): Promise<void>;
}

/**
 * Durable per-project source storage backed by a git repository on disk.
 * This — not the sandbox — is the source of truth for customer code.
 * With a mirror, the disk is a cache and the mirror is the durable copy.
 */
export class GitProjectStore {
  constructor(private readonly root: string, private readonly mirror?: RepoMirror) {}

  repoPath(projectId: string) {
    if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error('Invalid project id');
    return path.join(this.root, projectId);
  }

  private git(projectId: string, args: string[]) {
    return run('git', ['-c', 'user.name=Make Your App AI', '-c', 'user.email=bot@makeyourapp.ai', '-c', 'commit.gpgsign=false', ...args], {
      cwd: this.repoPath(projectId),
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async exists(projectId: string) {
    await this.sync(projectId);
    return this.localExists(projectId);
  }

  private async localExists(projectId: string) {
    try {
      await stat(path.join(this.repoPath(projectId), '.git'));
      return true;
    } catch {
      return false;
    }
  }

  private async localHead(projectId: string) {
    try {
      return (await this.git(projectId, ['rev-parse', 'HEAD'])).stdout.trim();
    } catch {
      return null;
    }
  }

  /** Makes the local repository match the mirror when it is missing or behind (another instance, a restart, a fresh disk). */
  private async sync(projectId: string) {
    if (!this.mirror) return;
    const head = await this.mirror.head(projectId);
    if (!head) return;
    if ((await this.localExists(projectId)) && (await this.localHead(projectId)) === head) return;
    const bundle = await this.mirror.load(projectId);
    if (!bundle) return;
    const dir = this.repoPath(projectId);
    const tmp = `${dir}.restore-${process.pid}-${Date.now()}`;
    const file = `${tmp}.bundle`;
    await mkdir(path.dirname(dir), { recursive: true });
    await writeFile(file, bundle);
    try {
      await run('git', ['clone', '-q', '-b', 'main', file, tmp]);
      await run('git', ['-C', tmp, 'remote', 'remove', 'origin']);
      await rm(dir, { recursive: true, force: true });
      await rename(tmp, dir);
    } finally {
      await rm(file, { force: true });
      await rm(tmp, { recursive: true, force: true });
    }
  }

  private async push(projectId: string, head: string) {
    if (!this.mirror) return;
    const { stdout } = await run('git', ['bundle', 'create', '-', '--all'], { cwd: this.repoPath(projectId), encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    await this.mirror.save(projectId, head, stdout as unknown as Buffer);
  }

  /**
   * Copies repositories that exist only on this disk into the mirror (for installs that had a persistent disk
   * before the mirror existed). Returns how many were copied.
   */
  async backfillMirror(): Promise<number> {
    if (!this.mirror) return 0;
    let copied = 0;
    let entries: string[] = [];
    try {
      entries = await readdir(this.root);
    } catch {
      return 0;
    }
    for (const id of entries.filter((e) => /^[0-9a-f-]{36}$/.test(e))) {
      if (!(await this.localExists(id)) || (await this.mirror.head(id))) continue;
      const head = await this.localHead(id);
      if (!head) continue;
      await this.push(id, head);
      copied++;
    }
    return copied;
  }

  async init(projectId: string) {
    await mkdir(this.repoPath(projectId), { recursive: true });
    await this.git(projectId, ['init', '-q', '-b', 'main']);
  }

  /** Replaces the working tree with `tree`, commits, and returns the commit SHA (or null if nothing changed). */
  async commit(projectId: string, tree: FileTree, message: string): Promise<string | null> {
    if (!(await this.exists(projectId))) await this.init(projectId);
    const dir = this.repoPath(projectId);
    for (const entry of await readdir(dir)) if (entry !== '.git') await rm(path.join(dir, entry), { recursive: true, force: true });
    for (const [p, content] of tree) {
      const abs = path.join(dir, safePath(p));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    await this.git(projectId, ['add', '-A']);
    const { stdout: status } = await this.git(projectId, ['status', '--porcelain']);
    if (!status.trim()) return null;
    await this.git(projectId, ['commit', '-q', '-m', message]);
    const head = (await this.git(projectId, ['rev-parse', 'HEAD'])).stdout.trim();
    // The commit only counts once it is in the durable copy: a failure here fails the caller.
    await this.push(projectId, head);
    return head;
  }

  /** Reads the full tree at a commit (defaults to HEAD). */
  async readTree(projectId: string, ref = 'HEAD'): Promise<FileTree> {
    const tree: FileTree = new Map();
    if (!(await this.exists(projectId))) return tree;
    const { stdout } = await this.git(projectId, ['ls-tree', '-r', '-z', '--name-only', ref]);
    for (const p of stdout.split('\0').filter(Boolean)) {
      const { stdout: content } = await this.git(projectId, ['show', `${ref}:${p}`]);
      tree.set(p, content);
    }
    return tree;
  }

  async log(projectId: string, limit = 50) {
    if (!(await this.exists(projectId))) return [];
    const { stdout } = await this.git(projectId, ['log', `-${limit}`, '--format=%H%x1f%s%x1f%cI']);
    return stdout.trim().split('\n').filter(Boolean).map((l) => {
      const [sha, subject, date] = l.split('\x1f');
      return { sha: sha!, subject: subject!, date: date! };
    });
  }

  /** Writes a tree to an arbitrary directory (used to stage sandbox workspaces). */
  static async materialize(tree: FileTree, dir: string) {
    for (const [p, content] of tree) {
      const abs = path.join(dir, safePath(p));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
  }

  static async readFileFrom(dir: string, p: string) {
    return readFile(path.join(dir, safePath(p)), 'utf8');
  }
}
