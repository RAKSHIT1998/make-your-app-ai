import type { PrismaClient } from '@mya/db';
import type { RepoMirror } from '@mya/codegen';

/** Keeps each project's git bundle in Postgres, so the API's disk is only a cache. */
export class PostgresRepoMirror implements RepoMirror {
  constructor(private readonly prisma: PrismaClient) {}

  async head(projectId: string) {
    return (await this.prisma.projectRepo.findUnique({ where: { projectId }, select: { head: true } }))?.head ?? null;
  }

  async load(projectId: string) {
    const row = await this.prisma.projectRepo.findUnique({ where: { projectId }, select: { bundle: true } });
    return row ? Buffer.from(row.bundle) : null;
  }

  async save(projectId: string, head: string, bundle: Buffer) {
    const data = { head, bundle: new Uint8Array(bundle), sizeBytes: bundle.length };
    await this.prisma.projectRepo.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
  }
}
