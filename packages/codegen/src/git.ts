import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { safePath, type FileTree } from './patch.js';

const run = promisify(execFile);

/**
 * Durable per-project source storage backed by a git repository on disk.
 * This — not the sandbox — is the source of truth for customer code.
 * In production STORAGE_DIR sits on a persistent volume and repos are mirrored to object storage.
 */
export class GitProjectStore {
  constructor(private readonly root: string) {}

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
    try {
      await stat(path.join(this.repoPath(projectId), '.git'));
      return true;
    } catch {
      return false;
    }
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
    return (await this.git(projectId, ['rev-parse', 'HEAD'])).stdout.trim();
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
