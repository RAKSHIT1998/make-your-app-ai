import { describe, expect, it } from 'vitest';
import { templateForProjectType, treeFromTemplate } from '@mya/codegen';
import { LocalProcessSandbox } from '../src/index.js';

describe('LocalProcessSandbox', () => {
  it('runs allowed commands with a scrubbed env and enforces timeouts', async () => {
    process.env['SUPER_SECRET_KEY'] = 'should-not-leak';
    const s = await new LocalProcessSandbox().create();
    try {
      const ok = await s.run(['node', '-e', 'console.log(process.env.SUPER_SECRET_KEY ?? "clean")']);
      expect(ok).toMatchObject({ exitCode: 0, timedOut: false });
      expect(ok.output.trim()).toBe('clean');
      const slow = await s.run(['node', '-e', 'setTimeout(()=>{}, 60000)'], { timeoutMs: 500 });
      expect(slow.timedOut).toBe(true);
      await expect(s.run(['bash', '-c', 'echo hi'])).rejects.toThrow('not allowed');
    } finally {
      await s.dispose();
    }
  });

  // Full install + typecheck + production build of the website template (~1–3 min, needs npm registry).
  it.runIf(process.env['SANDBOX_INTEGRATION'] === '1')('builds the Next.js website template end to end', async () => {
    const tpl = templateForProjectType('website')!;
    const s = await new LocalProcessSandbox().create();
    try {
      await s.writeFiles(treeFromTemplate(tpl));
      const install = await s.run(tpl.install, { timeoutMs: 300_000 });
      expect(install.exitCode, install.output).toBe(0);
      for (const check of tpl.checks) {
        const r = await s.run(check.cmd, { timeoutMs: 300_000 });
        expect(r.exitCode, `${check.name}:\n${r.output}`).toBe(0);
      }
    } finally {
      await s.dispose();
    }
  }, 600_000);
});
