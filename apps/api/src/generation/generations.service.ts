import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { BudgetExceededError, NoRouteError, type ProviderRouter, type UsageRecord } from '@mya/ai';
import { supportsProjectType, type AgentName, type GenerationOutcome, type Orchestrator, type RunReporter } from '@mya/agents';
import type { FilePatch, FileTree, GitProjectStore } from '@mya/codegen';
import type { GenerationRun, Prisma, PrismaClient, Project } from '@mya/db';
import { createHash } from 'node:crypto';
import { PRISMA } from '../prisma.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AI_ROUTER, ORCHESTRATOR, PROJECT_STORE } from '../ai/ai.providers.js';
import { CreditsService } from '../credits/credits.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';

const ACTIVE: GenerationRun['status'][] = ['queued', 'running'];
/** Minimum balance required to start a run (roughly one planning call). */
const MIN_CREDITS_TO_START = 5;

@Injectable()
export class GenerationsService {
  private readonly log = new Logger(GenerationsService.name);
  /** In-process execution for now; Phase 2b moves this onto Inngest durable steps. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_ROUTER) private readonly router: ProviderRouter,
    @Inject(ORCHESTRATOR) private readonly orchestrator: Orchestrator,
    @Inject(PROJECT_STORE) private readonly store: GitProjectStore,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async start(user: AuthUser, projectId: string, prompt: string, ip: string | null) {
    const project = await this.projects.getAuthorized(user, projectId, 'member');
    if (!supportsProjectType(project.type)) {
      throw new UnprocessableEntityException(`Generation for "${project.type}" projects is not available yet. Websites and business websites are supported today.`);
    }
    if (this.router.candidates('balanced').length === 0) {
      throw new HttpException('AI generation is not configured on this server (no AI provider key).', HttpStatus.SERVICE_UNAVAILABLE);
    }
    await this.credits.assertCanSpend(project.organizationId, MIN_CREDITS_TO_START);

    const kind = project.headVersionId ? 'edit' : 'create';
    const run = await this.prisma.$transaction(async (tx) => {
      // Lock the project row so two concurrent starts can't both pass the "no active run" check.
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id}::uuid FOR UPDATE`;
      const active = await tx.generationRun.findFirst({ where: { projectId: project.id, status: { in: ACTIVE } } });
      if (active) throw new ConflictException({ message: 'A generation is already running for this project.', runId: active.id });
      const r = await tx.generationRun.create({ data: { projectId: project.id, requestedBy: user.id, kind, prompt } });
      await tx.project.update({ where: { id: project.id }, data: { status: 'generating' } });
      await this.audit.record({ action: 'generation.started', actorId: user.id, organizationId: project.organizationId, targetType: 'generation_run', targetId: r.id, ip, metadata: { kind } }, tx);
      return r;
    });

    const p = this.execute(run.id, project).finally(() => this.inflight.delete(run.id));
    this.inflight.set(run.id, p);
    return this.toRunDto(run);
  }

  /** Test/shutdown helper. */
  async waitFor(runId: string) {
    await this.inflight.get(runId);
  }

  private reporter(runId: string): RunReporter {
    return {
      event: async (type, message, data = {}, agent) => {
        await this.prisma.agentEvent.create({ data: { generationRunId: runId, type, message: message.slice(0, 2000), data: data as Prisma.InputJsonValue, agent: agent ?? null } });
      },
      taskStarted: async (agent, input, attempt) => {
        const t = await this.prisma.agentTask.create({ data: { generationRunId: runId, agent, attempt, status: 'running', input: input as Prisma.InputJsonValue, startedAt: new Date() } });
        return t.id;
      },
      taskFinished: async (taskId, ok, out) => {
        await this.prisma.agentTask.update({
          where: { id: taskId },
          data: ok ? { status: 'succeeded', output: out as Prisma.InputJsonValue, finishedAt: new Date() } : { status: 'failed', error: String(out).slice(0, 4000), finishedAt: new Date() },
        });
      },
    };
  }

  private async execute(runId: string, project: Project) {
    const reporter = this.reporter(runId);
    let runCredits = 0;
    let currentAgent: AgentName | null = null;
    const orgId = project.organizationId;

    const onUsage = async (u: UsageRecord) => {
      const credits = this.credits.creditsForCost(u.costMicros);
      runCredits += credits;
      await this.prisma.$transaction(async (tx) => {
        const usage = await tx.aiUsage.create({
          data: { organizationId: orgId, generationRunId: runId, provider: u.provider, model: u.model, agent: currentAgent, inputTokens: u.inputTokens, outputTokens: u.outputTokens, costMicros: BigInt(u.costMicros), creditsCharged: credits, latencyMs: u.latencyMs, success: u.success },
        });
        await this.credits.debit(tx, orgId, credits, `usage:${usage.id}`, { type: 'ai_usage', id: usage.id });
        await tx.generationRun.update({ where: { id: runId }, data: { creditsUsed: { increment: credits } } });
      });
    };
    const checkBudget = async (worstMicros: number) => {
      const worst = this.credits.creditsForCost(worstMicros);
      if (runCredits + worst > this.config.MAX_CREDITS_PER_RUN) throw new BudgetExceededError(`This run reached its limit of ${this.config.MAX_CREDITS_PER_RUN} credits.`);
      const bal = await this.credits.balance(orgId);
      if (bal < worst) throw new BudgetExceededError(`Not enough credits to continue (balance ${bal}, next step may need up to ${worst}).`);
    };

    try {
      await this.prisma.generationRun.update({ where: { id: runId }, data: { status: 'running', startedAt: new Date() } });
      const run = await this.prisma.generationRun.findUniqueOrThrow({ where: { id: runId } });
      const outcome = await this.orchestrator.run(
        {
          projectId: project.id,
          projectType: project.type,
          projectName: project.name,
          kind: run.kind === 'create' ? 'create' : 'edit',
          prompt: run.prompt,
          templateKey: project.templateId,
          spec: (project.spec as never) ?? null,
          design: (project.designSpec as never) ?? null,
        },
        { router: this.router, reporter, budget: { checkBudget, onUsage, onUsageAgent: (a) => (currentAgent = a) } },
      );
      await this.finish(runId, project, run.requestedBy, outcome);
    } catch (e) {
      const message =
        e instanceof BudgetExceededError ? e.message
        : e instanceof NoRouteError ? 'No AI model is available right now.'
        : e instanceof Error ? e.message : String(e);
      this.log.warn(`run ${runId} failed: ${message}`);
      await reporter.event('run.failed', message).catch(() => {});
      await this.prisma.$transaction([
        this.prisma.generationRun.update({ where: { id: runId }, data: { status: 'failed', error: message.slice(0, 4000), finishedAt: new Date() } }),
        this.prisma.project.update({ where: { id: project.id }, data: { status: project.headVersionId ? 'ready' : 'error' } }),
      ]);
    }
  }

  private async finish(runId: string, project: Project, requestedBy: string, outcome: GenerationOutcome) {
    if (outcome.status === 'failed') throw new Error(outcome.error);
    if (outcome.status === 'awaiting_approval') {
      await this.prisma.$transaction([
        this.prisma.approvalRequest.create({
          data: {
            projectId: project.id,
            action: 'destructive_change',
            summary: `${outcome.summary}\n\nRemoves or rewrites: ${outcome.changes.destructive.join(', ')}`,
            payload: { runId, templateKey: outcome.templateKey, patches: outcome.patches } as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 7 * 864e5),
          },
        }),
        this.prisma.generationRun.update({ where: { id: runId }, data: { status: 'awaiting_approval', finishedAt: new Date() } }),
        this.prisma.project.update({ where: { id: project.id }, data: { status: 'ready' } }),
      ]);
      return;
    }
    await this.recordVersion(project, outcome.commitSha, outcome.tree, outcome.summary, runId, {
      templateId: outcome.templateKey,
      ...(outcome.spec ? { spec: outcome.spec as unknown as Prisma.InputJsonValue } : {}),
      ...(outcome.design ? { designSpec: outcome.design as unknown as Prisma.InputJsonValue } : {}),
    });
    void requestedBy;
  }

  /** Creates the ProjectVersion, moves head, refreshes the file index and marks the run succeeded. */
  private async recordVersion(project: Project, commitSha: string | null, tree: FileTree, message: string, runId: string | null, projectData: Prisma.ProjectUncheckedUpdateInput = {}) {
    await this.prisma.$transaction(async (tx) => {
      let headVersionId = project.headVersionId;
      if (commitSha) {
        const last = await tx.projectVersion.findFirst({ where: { projectId: project.id }, orderBy: { number: 'desc' }, select: { number: true } });
        const v = await tx.projectVersion.create({
          data: { projectId: project.id, number: (last?.number ?? 0) + 1, commitSha, message: message.slice(0, 1000), ...(runId ? { generationRunId: runId } : {}) },
        });
        headVersionId = v.id;
        await tx.projectFile.deleteMany({ where: { projectId: project.id } });
        await tx.projectFile.createMany({
          data: [...tree].map(([path, content]) => ({
            projectId: project.id,
            path,
            sha256: createHash('sha256').update(content).digest('hex'),
            sizeBytes: Buffer.byteLength(content),
            content: content.length < 256 * 1024 ? content : null,
          })),
        });
      }
      await tx.project.update({ where: { id: project.id }, data: { ...projectData, status: 'ready', headVersionId } });
      if (runId) await tx.generationRun.update({ where: { id: runId }, data: { status: 'succeeded', finishedAt: new Date() } });
    });
  }

  // ───────────────────────── Queries ─────────────────────────

  private async getAuthorizedRun(user: AuthUser, runId: string) {
    const run = await this.prisma.generationRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found');
    try {
      await this.projects.getAuthorized(user, run.projectId, 'viewer');
    } catch {
      throw new NotFoundException('Run not found');
    }
    return run;
  }

  toRunDto(r: GenerationRun) {
    return { id: r.id, projectId: r.projectId, kind: r.kind, status: r.status, prompt: r.prompt, error: r.error, creditsUsed: r.creditsUsed, createdAt: r.createdAt.toISOString(), startedAt: r.startedAt?.toISOString() ?? null, finishedAt: r.finishedAt?.toISOString() ?? null };
  }

  async getRun(user: AuthUser, runId: string) {
    const run = await this.getAuthorizedRun(user, runId);
    const tasks = await this.prisma.agentTask.findMany({ where: { generationRunId: runId }, orderBy: { startedAt: 'asc' }, select: { id: true, agent: true, status: true, attempt: true, error: true, startedAt: true, finishedAt: true } });
    return { ...this.toRunDto(run), tasks };
  }

  async events(user: AuthUser, runId: string, after: bigint) {
    await this.getAuthorizedRun(user, runId);
    const rows = await this.prisma.agentEvent.findMany({ where: { generationRunId: runId, id: { gt: after } }, orderBy: { id: 'asc' }, take: 500 });
    return rows.map((e) => ({ id: e.id.toString(), type: e.type, agent: e.agent, message: e.message, data: e.data, createdAt: e.createdAt.toISOString() }));
  }

  async listRuns(user: AuthUser, projectId: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const runs = await this.prisma.generationRun.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return runs.map((r) => this.toRunDto(r));
  }

  async listFiles(user: AuthUser, projectId: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    return this.prisma.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' }, select: { path: true, sizeBytes: true, sha256: true } });
  }

  async fileContent(user: AuthUser, projectId: string, path: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const f = await this.prisma.projectFile.findUnique({ where: { projectId_path: { projectId, path } } });
    if (!f) throw new NotFoundException('File not found');
    const content = f.content ?? (await this.store.readTree(projectId)).get(path) ?? null;
    return { path: f.path, sizeBytes: f.sizeBytes, content };
  }

  async listVersions(user: AuthUser, projectId: string) {
    const p = await this.projects.getAuthorized(user, projectId, 'viewer');
    const versions = await this.prisma.projectVersion.findMany({ where: { projectId }, orderBy: { number: 'desc' } });
    return versions.map((v) => ({ id: v.id, number: v.number, commitSha: v.commitSha, message: v.message, createdAt: v.createdAt.toISOString(), isHead: v.id === p.headVersionId }));
  }

  /** Undo: restores an earlier version by committing its tree as a NEW version (history is never rewritten). */
  async restoreVersion(user: AuthUser, projectId: string, versionId: string, ip: string | null) {
    const project = await this.projects.getAuthorized(user, projectId, 'member');
    const v = await this.prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
    if (!v) throw new NotFoundException('Version not found');
    if (await this.prisma.generationRun.findFirst({ where: { projectId, status: { in: ACTIVE } } })) throw new ConflictException('Wait for the running generation to finish.');
    const tree = await this.store.readTree(projectId, v.commitSha);
    const sha = await this.store.commit(projectId, tree, `Restore version ${v.number}`);
    await this.recordVersion(project, sha, tree, `Restored version ${v.number}`, null);
    await this.audit.record({ action: 'project.version_restored', actorId: user.id, organizationId: project.organizationId, targetType: 'project', targetId: projectId, ip, metadata: { versionNumber: v.number } });
    return this.listVersions(user, projectId);
  }

  // ───────────────────────── Approvals ─────────────────────────

  async listApprovals(user: AuthUser, projectId: string) {
    await this.projects.getAuthorized(user, projectId, 'viewer');
    const rows = await this.prisma.approvalRequest.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((a) => ({ id: a.id, action: a.action, status: a.status, summary: a.summary, createdAt: a.createdAt.toISOString(), expiresAt: a.expiresAt.toISOString() }));
  }

  async decide(user: AuthUser, approvalId: string, approve: boolean, ip: string | null) {
    const a = await this.prisma.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!a) throw new NotFoundException('Approval not found');
    const project = await this.projects.getAuthorized(user, a.projectId, approve ? 'admin' : 'member').catch((e: unknown) => {
      throw e instanceof NotFoundException ? new NotFoundException('Approval not found') : e;
    });
    if (a.status !== 'pending') throw new ConflictException(`Already ${a.status}`);
    if (a.expiresAt < new Date()) {
      await this.prisma.approvalRequest.update({ where: { id: a.id }, data: { status: 'expired' } });
      throw new ConflictException('This approval has expired. Ask for the change again.');
    }
    // Claim atomically so a double-click can't apply twice.
    const claimed = await this.prisma.approvalRequest.updateMany({ where: { id: a.id, status: 'pending' }, data: { status: approve ? 'approved' : 'rejected', decidedById: user.id, decidedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictException('Already decided');
    await this.audit.record({ action: approve ? 'approval.approved' : 'approval.rejected', actorId: user.id, organizationId: project.organizationId, targetType: 'approval', targetId: a.id, ip });
    if (!approve) return { status: 'rejected' as const };

    const payload = a.payload as { runId: string; templateKey: string; patches: FilePatch[] };
    const reporter = this.reporter(payload.runId);
    const result = await this.orchestrator.applyApproved(
      { projectId: project.id, templateKey: payload.templateKey, patches: payload.patches, message: `Approved change (${a.id.slice(0, 8)})` },
      { router: this.router, reporter, budget: {} },
    );
    if (result.status === 'failed') {
      await this.prisma.generationRun.update({ where: { id: payload.runId }, data: { status: 'failed', error: result.error } });
      return { status: 'failed' as const, error: result.error };
    }
    await this.recordVersion(project, result.commitSha, result.tree, 'Approved change', null);
    await this.prisma.generationRun.update({ where: { id: payload.runId }, data: { status: 'succeeded', finishedAt: new Date() } });
    return { status: 'applied' as const };
  }

}
