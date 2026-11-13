import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { templateForProjectType, treeFromTemplate, validateTree } from '../src/index.js';

describe('built-in app backend', () => {
  const fxr = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
  const TASKS = () => new Map(Object.entries({ 'package.json': '{"name":"t","version":"1.0.0"}', 'index.html': fxr('tasks-index.html'), 'style.css': fxr('tasks-style.css'), 'app.js': fxr('tasks-app.js'), 'app.backend.json': fxr('tasks-backend.json') }));

  it('accepts a real full-stack app', () => {
    expect(validateTree(TASKS())).toEqual([]);
  });

  it('catches the mistakes an AI makes with the backend contract', () => {
    const t = TASKS();
    t.set('app.js', `${t.get('app.js')}\nApp.db.list('projects');\nfetch('/x');\n`);
    const issues = validateTree(t).map((i) => i.message).join('\n');
    expect(issues).toContain('collection "projects" which is not declared');
    expect(issues).toContain('Talk to the backend only through App.db and App.auth');

    const noFile = TASKS(); noFile.delete('app.backend.json');
    expect(validateTree(noFile).map((i) => i.message).join('\n')).toContain('there is no app.backend.json');

    const bad = TASKS();
    bad.set('app.backend.json', JSON.stringify({ auth: { enabled: false }, collections: { tasks: { fields: { id: { type: 'string' }, kind: { type: 'enum' } }, access: { read: 'owner', create: 'users', modify: 'owner' } } } }));
    const msgs = validateTree(bad).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/added automatically/);
    expect(msgs).toMatch(/enum field needs "values"/);
    expect(msgs).toMatch(/needs signed-in users/);

    const redefine = TASKS(); redefine.set('app.js', 'window.App = {};');
    expect(validateTree(redefine).map((i) => i.message).join('\n')).toContain('Redefines App');
  });
});

it('the full-stack starter template passes its own checks', () => {
  expect(validateTree(treeFromTemplate(templateForProjectType('saas')!))).toEqual([]);
});

it('free services need the built-in backend (they go through the same SDK)', () => {
  const t = new Map([['index.html', '<!doctype html><html><head><title>x</title></head><body><script src="app.js"></script></body></html>'], ['app.js', "App.services.currency.convert(10, 'USD', 'INR');\n"]]);
  expect(validateTree(t).map((i) => i.message).join('\n')).toContain('there is no app.backend.json');
});
