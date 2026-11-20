import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitProjectStore, type RepoMirror } from '../src/git.js';

class MemoryMirror implements RepoMirror {
  rows = new Map<string, { head: string; bundle: Buffer }>();
  saves = 0;
  fail = false;
  async head(id: string) { return this.rows.get(id)?.head ?? null; }
  async load(id: string) { return this.rows.get(id)?.bundle ?? null; }
  async save(id: string, head: string, bundle: Buffer) {
    if (this.fail) throw new Error('mirror down');
    this.saves++;
    this.rows.set(id, { head, bundle });
  }
}

const dirs: string[] = [];
const tmp = async () => { const d = await mkdtemp(path.join(tmpdir(), 'mya-mirror-')); dirs.push(d); return d; };
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });
const ID = '0b6a5e1e-7c1d-4c8e-9d1a-2f2a4b5c6d7e';

describe('GitProjectStore with a durable mirror', () => {
  it('survives a lost disk, follows commits made by another instance, and keeps history', async () => {
    const mirror = new MemoryMirror();
    const rootA = await tmp();
    const a = new GitProjectStore(rootA, mirror);
    const v1 = await a.commit(ID, new Map([['index.html', '<h1>One</h1>']]), 'v1');
    expect(mirror.saves).toBe(1);
    expect(await mirror.head(ID)).toBe(v1);

    // The disk is wiped (redeploy on a host without a persistent disk): everything comes back.
    await rm(rootA, { recursive: true, force: true });
    expect((await a.readTree(ID)).get('index.html')).toBe('<h1>One</h1>');

    // A second instance with its own empty disk sees the same code, then commits on top of it.
    const b = new GitProjectStore(await tmp(), mirror);
    expect((await b.readTree(ID, v1!)).get('index.html')).toBe('<h1>One</h1>');
    const v2 = await b.commit(ID, new Map([['index.html', '<h1>Two</h1>'], ['app.js', 'let x = 1;']]), 'v2');

    // The first instance is now behind; its next read catches up, and old versions are still there.
    expect((await a.readTree(ID)).get('index.html')).toBe('<h1>Two</h1>');
    expect((await a.readTree(ID, v1!)).get('index.html')).toBe('<h1>One</h1>');
    expect((await a.log(ID)).map((l) => l.sha)).toEqual([v2, v1]);
  });

  it('a commit that cannot reach the mirror fails and is not kept', async () => {
    const mirror = new MemoryMirror();
    const s = new GitProjectStore(await tmp(), mirror);
    const v1 = await s.commit(ID, new Map([['a.txt', 'one']]), 'v1');
    mirror.fail = true;
    await expect(s.commit(ID, new Map([['a.txt', 'two']]), 'v2')).rejects.toThrow('mirror down');
    mirror.fail = false;
    expect((await s.readTree(ID)).get('a.txt')).toBe('one');
    expect((await s.log(ID)).map((l) => l.sha)).toEqual([v1]);
  });

  it('copies repositories that existed only on disk into the mirror once', async () => {
    const root = await tmp();
    const head = await new GitProjectStore(root).commit(ID, new Map([['a.txt', 'one']]), 'v1');
    const mirror = new MemoryMirror();
    const s = new GitProjectStore(root, mirror);
    expect(await s.backfillMirror()).toBe(1);
    expect(await mirror.head(ID)).toBe(head);
    expect(await s.backfillMirror()).toBe(0);
  });

  it('without a mirror behaves as before, and an unknown project is empty', async () => {
    const s = new GitProjectStore(await tmp());
    expect((await s.readTree(ID)).size).toBe(0);
    expect(await new GitProjectStore(await tmp(), new MemoryMirror()).log(ID)).toEqual([]);
  });
});
