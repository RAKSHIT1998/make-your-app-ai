import { z } from 'zod';
import path from 'node:path';

export const FilePatchSchema = z.object({
  op: z.enum(['create', 'update', 'delete']),
  path: z.string().min(1).max(300),
  content: z.string().max(400_000).optional(),
  reason: z.string().max(500),
});
export type FilePatch = z.infer<typeof FilePatchSchema>;

/** In-memory project tree: relative POSIX path → file content. */
export type FileTree = Map<string, string>;

const FORBIDDEN_SEGMENTS = new Set(['.git', 'node_modules', '.env']);

/** Normalises a model-supplied path and rejects anything that could escape the project root. */
export function safePath(p: string): string {
  if (p.includes('\0') || p.includes('\\')) throw new PatchError(`Illegal characters in path: ${p}`);
  if (path.posix.isAbsolute(p)) throw new PatchError(`Absolute paths are not allowed: ${p}`);
  const norm = path.posix.normalize(p).replace(/^\.\//, '');
  if (norm === '.' || norm.startsWith('..') || norm.split('/').includes('..')) throw new PatchError(`Path escapes project root: ${p}`);
  const segs = norm.split('/');
  if (segs.some((s) => FORBIDDEN_SEGMENTS.has(s) || s.startsWith('.env'))) throw new PatchError(`Path not writable by agents: ${p}`);
  return norm;
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchError';
  }
}

export interface PatchSummary {
  created: string[];
  updated: string[];
  deleted: string[];
  /** Deletes, or updates that remove more than 60% of an existing file's lines. */
  destructive: string[];
}

function lineLossRatio(before: string, after: string): number {
  const a = before.split('\n');
  if (a.length < 10) return 0; // tiny files: rewrites are normal
  const kept = new Set(after.split('\n').map((l) => l.trim()));
  const lost = a.filter((l) => l.trim() && !kept.has(l.trim())).length;
  return lost / a.filter((l) => l.trim()).length;
}

/** Applies patches to a copy of the tree. Never mutates the input. */
export function applyPatches(tree: FileTree, patches: FilePatch[]): { tree: FileTree; summary: PatchSummary } {
  const next = new Map(tree);
  const summary: PatchSummary = { created: [], updated: [], deleted: [], destructive: [] };
  for (const raw of patches) {
    const p = safePath(raw.path);
    if (raw.op === 'delete') {
      if (!next.has(p)) throw new PatchError(`Cannot delete missing file: ${p}`);
      next.delete(p);
      summary.deleted.push(p);
      summary.destructive.push(p);
      continue;
    }
    if (raw.content === undefined) throw new PatchError(`${raw.op} requires content: ${p}`);
    const existing = next.get(p);
    if (raw.op === 'create' && existing !== undefined && existing !== raw.content) {
      // Treat as update so the destructive check still applies.
      summary.updated.push(p);
      if (lineLossRatio(existing, raw.content) > 0.6) summary.destructive.push(p);
    } else if (raw.op === 'update') {
      if (existing === undefined) summary.created.push(p);
      else {
        summary.updated.push(p);
        if (lineLossRatio(existing, raw.content) > 0.6) summary.destructive.push(p);
      }
    } else if (existing === undefined) {
      summary.created.push(p);
    }
    next.set(p, raw.content);
  }
  return { tree: next, summary };
}
