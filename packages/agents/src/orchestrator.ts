import { applyPatches, getTemplate, templateForProjectType, templateKey, treeFromTemplate, validateTree, type FilePatch, type FileTree, type GitProjectStore, type PatchSummary, type ProjectTemplate } from '@mya/codegen';
import type { SandboxProvider } from '@mya/sandbox';
import { CodeChangeSchema, DesignSpecSchema, ProductSpecSchema, QaFixSchema, type DesignSpec, type ProductSpec } from './contracts.js';
import { runAgent, wrap, type AgentCallContext } from './runner.js';

export interface GenerationInput {
  projectId: string;
  projectType: string;
  projectName: string;
  kind: 'create' | 'edit';
  prompt: string;
  templateKey?: string | null;
  spec?: ProductSpec | null;
  design?: DesignSpec | null;
}

export type GenerationOutcome =
  | { status: 'succeeded'; commitSha: string | null; templateKey: string; spec: ProductSpec | null; design: DesignSpec | null; summary: string; changes: PatchSummary; tree: FileTree; checks: CheckReport[] }
  | { status: 'awaiting_approval'; templateKey: string; summary: string; changes: PatchSummary; patches: FilePatch[] }
  | { status: 'failed'; error: string };

export interface CheckReport {
  name: string;
  ok: boolean;
  durationMs: number;
  outputTail: string;
}

export interface OrchestratorDeps {
  store: GitProjectStore;
  /** When absent, only static validation runs (and the run reports that build checks were skipped). */
  sandbox?: SandboxProvider;
  maxRepairLoops?: number;
}

export class UnsupportedProjectTypeError extends Error {}

const MAX_CONTEXT_CHARS = 180_000;
const TEXT_FILE = /\.(tsx?|jsx?|mjs|cjs|css|json|md|txt|svg|html|ya?ml)$/;

export function supportsProjectType(type: string) {
  return templateForProjectType(type) !== undefined;
}

function fileContext(tree: FileTree): string {
  const parts: string[] = [];
  let used = 0;
  const entries = [...tree.entries()].filter(([p]) => TEXT_FILE.test(p) && p !== 'package-lock.json').sort(([a], [b]) => a.localeCompare(b));
  for (const [p, c] of entries) {
    const block = wrap('project_file', c, `path="${p}"`);
    if (used + block.length > MAX_CONTEXT_CHARS) {
      parts.push(`<!-- ${p} omitted (${c.length} chars) -->`);
      continue;
    }
    used += block.length;
    parts.push(block);
  }
  return parts.join('\n');
}

function tail(s: string, n = 6000) {
  return s.length > n ? s.slice(-n) : s;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(input: GenerationInput, ctx: AgentCallContext): Promise<GenerationOutcome> {
    const r = ctx.reporter;
    const template: ProjectTemplate | undefined = input.templateKey ? getTemplate(input.templateKey) : templateForProjectType(input.projectType);
    if (!template) throw new UnsupportedProjectTypeError(`Generation for "${input.projectType}" projects is not available yet.`);
    const tKey = templateKey(template);

    let spec = input.spec ?? null;
    let design = input.design ?? null;
    let base: FileTree;

    if (input.kind === 'create') {
      await r.event('step.started', 'Planning the product', {}, 'architect');
      spec = await runAgent(ctx, {
        agent: 'architect',
        tier: 'balanced',
        maxOutputTokens: 8000,
        schema: ProductSpecSchema,
        role: `You are the Product Architect for "Make Your App AI". Turn a customer's idea into a concrete product specification for a ${input.projectType.replace('_', ' ')} built from this template: ${template.description}
Keep scope realistic for a first version: 1–8 pages. Mark any third-party integration that needs the customer's own account or keys with requiresCustomerConfig=true. Never invent statistics, testimonials or claims about the customer's business; use clearly-marked placeholder copy where facts are unknown.`,
        content: `Project name: ${input.projectName}\n${wrap('customer_request', input.prompt)}`,
      });
      await r.event('step.completed', `Spec ready: ${spec.pages.length} page(s)`, { pages: spec.pages.map((p) => p.route) }, 'architect');

      await r.event('step.started', 'Designing the visual system', {}, 'designer');
      design = await runAgent(ctx, {
        agent: 'designer',
        tier: 'fast',
        maxOutputTokens: 3000,
        schema: DesignSpecSchema,
        role: 'You are the UI/UX Designer. Produce a cohesive, accessible design system (WCAG AA contrast between text and background, and between primaryForeground and primary). Use system font stacks only — no web font downloads.',
        content: wrap('spec', JSON.stringify(spec, null, 2)),
      });
      await r.event('step.completed', `Design: ${design.tone}`, { palette: design.palette }, 'designer');
      base = treeFromTemplate(template);
    } else {
      base = await this.deps.store.readTree(input.projectId);
      if (base.size === 0) base = treeFromTemplate(template);
    }

    await r.event('step.started', input.kind === 'create' ? 'Writing the code' : 'Applying your change', {}, 'frontend');
    const change = await runAgent(ctx, {
      agent: 'frontend',
      tier: 'balanced',
      maxOutputTokens: 48_000,
      schema: CodeChangeSchema,
      role: `You are a senior frontend engineer. You modify an existing project by returning file patches.
Rules:
- Return the MINIMUM set of patches that fulfils the request. Do not rewrite files you don't need to change.
- "create"/"update" patches carry the COMPLETE new file content. Never use placeholders like "// ...rest unchanged".
- Every import must resolve: a file in the project (existing or created in this same response) or a package listed in package.json.
- Paths are relative to the project root. Never touch .env files, node_modules or .git.
- TypeScript must compile under "strict".
Template rules:
${template.agentGuide.map((g) => `- ${g}`).join('\n')}`,
      content: [
        spec ? wrap('spec', JSON.stringify(spec, null, 2)) : '',
        design ? wrap('design', JSON.stringify(design, null, 2)) : '',
        `Current project files:\n${fileContext(base)}`,
        input.kind === 'create'
          ? 'Implement the full first version of this product from the spec and design.'
          : `Apply this change requested by the customer:\n${wrap('customer_request', input.prompt)}`,
      ].filter(Boolean).join('\n\n'),
    });

    let { tree, summary } = applyPatches(base, change.patches);
    await r.event('files.changed', change.summary, { ...summary }, 'frontend');

    if (input.kind === 'edit' && summary.destructive.length > 0) {
      await r.event('approval.required', `This change removes or rewrites existing files: ${summary.destructive.join(', ')}`, { files: summary.destructive });
      return { status: 'awaiting_approval', templateKey: tKey, summary: change.summary, changes: summary, patches: change.patches };
    }

    const verified = await this.verifyAndRepair(tree, template, ctx);
    if (!verified.ok) return { status: 'failed', error: verified.error };
    tree = verified.tree;

    const sha = await this.deps.store.commit(input.projectId, tree, `${input.kind === 'create' ? 'Generate' : 'Edit'}: ${input.prompt.slice(0, 72).replace(/\s+/g, ' ')}`);
    await r.event('version.committed', sha ? `Saved version ${sha.slice(0, 7)}` : 'No file changes to save', { sha });
    return { status: 'succeeded', commitSha: sha, templateKey: tKey, spec, design, summary: change.summary, changes: summary, tree, checks: verified.checks };
  }

  /** Applies already-approved patches (from an awaiting_approval run) and verifies them. */
  async applyApproved(input: { projectId: string; templateKey: string; patches: FilePatch[]; message: string }, ctx: AgentCallContext) {
    const template = getTemplate(input.templateKey);
    if (!template) throw new Error(`Unknown template ${input.templateKey}`);
    const base = await this.deps.store.readTree(input.projectId);
    const { tree } = applyPatches(base, input.patches);
    const verified = await this.verifyAndRepair(tree, template, ctx);
    if (!verified.ok) return { status: 'failed' as const, error: verified.error };
    const sha = await this.deps.store.commit(input.projectId, verified.tree, input.message);
    await ctx.reporter.event('version.committed', sha ? `Saved version ${sha.slice(0, 7)}` : 'No file changes to save', { sha });
    return { status: 'succeeded' as const, commitSha: sha, tree: verified.tree, checks: verified.checks };
  }

  private async verifyAndRepair(tree: FileTree, template: ProjectTemplate, ctx: AgentCallContext): Promise<{ ok: true; tree: FileTree; checks: CheckReport[] } | { ok: false; error: string }> {
    const r = ctx.reporter;
    const maxLoops = this.deps.maxRepairLoops ?? 2;
    for (let loop = 0; ; loop++) {
      const problems: string[] = [];
      const checks: CheckReport[] = [];
      const issues = validateTree(tree);
      if (issues.length) {
        problems.push(...issues.map((i) => `${i.file}: ${i.message}`));
        await r.event('check.failed', `Static validation found ${issues.length} problem(s)`, { issues }, 'qa');
      } else if (this.deps.sandbox) {
        const failed = await this.runChecks(tree, template, checks, ctx);
        if (failed) problems.push(failed);
      } else {
        await r.event('check.skipped', 'Static validation passed. Build checks skipped: no sandbox configured.', {}, 'qa');
      }
      if (problems.length === 0) {
        await r.event('step.completed', 'All checks passed', { checks }, 'qa');
        return { ok: true, tree, checks };
      }
      if (loop >= maxLoops) return { ok: false, error: `Checks still failing after ${maxLoops} repair attempts:\n${tail(problems.join('\n'), 2000)}` };

      await r.event('step.started', `Repairing (attempt ${loop + 1}/${maxLoops})`, {}, 'qa');
      const fix = await runAgent(ctx, {
        agent: 'qa',
        tier: 'balanced',
        maxOutputTokens: 32_000,
        schema: QaFixSchema,
        role: `You are the QA & Debugging engineer. Diagnose the failing checks and return the minimal patches that fix them. "update" patches carry complete file content.
Template rules:
${template.agentGuide.map((g) => `- ${g}`).join('\n')}`,
        content: `${wrap('check_output', tail(problems.join('\n'), 12_000))}\n\nCurrent project files:\n${fileContext(tree)}`,
      });
      ({ tree } = applyPatches(tree, fix.patches));
      await r.event('files.changed', fix.diagnosis, { patches: fix.patches.map((p) => `${p.op} ${p.path}`) }, 'qa');
    }
  }

  /** Returns a failure description, or null if all template checks pass. */
  private async runChecks(tree: FileTree, template: ProjectTemplate, checks: CheckReport[], ctx: AgentCallContext): Promise<string | null> {
    const r = ctx.reporter;
    const session = await this.deps.sandbox!.create({ projectId: 'run' });
    try {
      await session.writeFiles(tree);
      await r.event('check.started', 'Installing dependencies', {}, 'qa');
      const install = await session.run(template.install, { timeoutMs: 300_000, network: true });
      checks.push({ name: 'install', ok: install.exitCode === 0, durationMs: install.durationMs, outputTail: tail(install.output, 2000) });
      if (install.exitCode !== 0) return `install failed${install.timedOut ? ' (timed out)' : ''}:\n${tail(install.output)}`;
      for (const c of template.checks) {
        await r.event('check.started', `Running ${c.name}`, {}, 'qa');
        const res = await session.run(c.cmd, { timeoutMs: 300_000 });
        const ok = res.exitCode === 0;
        checks.push({ name: c.name, ok, durationMs: res.durationMs, outputTail: tail(res.output, 2000) });
        await r.event(ok ? 'check.passed' : 'check.failed', `${c.name} ${ok ? 'passed' : 'failed'} (${Math.round(res.durationMs / 1000)}s)`, { name: c.name }, 'qa');
        if (!ok) return `${c.name} failed${res.timedOut ? ' (timed out)' : ''}:\n${tail(res.output)}`;
      }
      return null;
    } finally {
      await session.dispose();
    }
  }
}
