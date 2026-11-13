import type { ProjectTemplate } from './types.js';

const j = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * Full-stack browser app: HTML/CSS/vanilla JS front end plus the platform's built-in backend (database, end-user
 * accounts and access rules declared in app.backend.json, reached only through the injected `App` SDK).
 * No server code is generated or run. Bump `version` on any change.
 */
export const fullstackWebTemplate: ProjectTemplate = {
  id: 'fullstack-web',
  version: 1,
  projectTypes: ['saas'],
  description:
    'A full-stack web app: index.html, style.css, app.js in plain JavaScript, plus app.backend.json which declares the database collections, user sign-up/sign-in and who may read or change each record. The platform hosts the backend; the code talks to it only through the global `App` object.',
  install: ['node', '--version'],
  checks: [{ name: 'syntax', cmd: ['node', '--check', 'app.js'] }],
  preview: { cmd: ['npx', '--yes', 'serve', '-l', '{PORT}', '.'], readyPath: '/' },
  agentGuide: [
    'Files: index.html, style.css, app.js (more .js/.css only if needed, loaded as classic scripts in order before </body>; NEVER type="module", import or export) and app.backend.json.',
    'app.backend.json declares the backend. Shape: {"auth":{"enabled":true},"collections":{"<name>":{"fields":{"<field>":{"type":"string|text|number|boolean|date|email|enum","required":true,"max":120,"values":["a","b"]}},"access":{"read":"public|users|owner","create":"public|users","modify":"owner|none"}}}}. Names: lowercase first letter, letters/digits/_ only. Do not declare id, createdAt, updatedAt, mine or owner: they are added to every record automatically. "values" only for enum. Set auth.enabled true whenever any rule needs signed-in users.',
    'Access rules: read "owner" = each user sees only their own records (private data such as tasks, notes, orders); "users" = any signed-in user; "public" = anyone, even signed out. create "users" requires sign-in. modify "owner" lets the creator edit/delete; "none" makes records permanent. Choose the strictest rule that fits.',
    'Talk to the backend ONLY through the global App object (it is provided by the platform; never define it, never call fetch/XMLHttpRequest/WebSocket). Every call returns a Promise and throws an Error with a user-friendly .message and .status on failure.',
    'App.ready → Promise resolving to the signed-in user or null (await it before the first render). App.auth.user() → {id,email} or null. App.auth.signUp(email,password) and App.auth.signIn(email,password) → user (password at least 8 characters). App.auth.signOut(). App.auth.onChange(cb) → unsubscribe; cb(user|null) fires on every sign-in/out, including when a session expires.',
    'App.db.list(collection, {mine?:true, where?:{field:value}, order?:"desc"|"asc", limit?:1-100, cursor?}) → {items, nextCursor}; newest first by default; pass nextCursor back to load more. App.db.get(collection,id) → record. App.db.create(collection,data) → record. App.db.update(collection,id,partialData) → record. App.db.remove(collection,id). A record is {id, createdAt, updatedAt, mine, ...fields} where mine is true when the signed-in user created it.',
    'Build a complete product: a sign-up / sign-in screen (email + password, clear errors, a switch between the two), the signed-in experience with real create, list, edit and delete wired to App.db, a visible sign-out, and loading, empty and error states. Disable buttons while a request is running. Re-render from the server response after each change.',
    'Never store passwords, tokens or secrets yourself; the SDK handles sessions. Do not put sample records in code and present them as real data. Escape user content: set it with textContent, never innerHTML.',
    'Use semantic HTML, label every input, support keyboard use with visible focus, and a layout that works from 320px wide. Include <meta name="viewport" content="width=device-width, initial-scale=1"> and a <title>.',
  ],
  files: {
    'package.json': j({ name: 'generated-fullstack', version: '1.0.0', private: true, scripts: { check: 'node --check app.js' } }),
    'app.backend.json': j({ auth: { enabled: true }, collections: { notes: { fields: { text: { type: 'text', required: true, max: 2000 } }, access: { read: 'owner', create: 'users', modify: 'owner' } } } }),
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My app</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="app" aria-live="polite"><p>Loading…</p></main>
  <script src="app.js"></script>
</body>
</html>
`,
    'style.css': `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; background: #f7f7f5; color: #18181b; }
main { max-width: 560px; margin: 0 auto; padding: 24px 16px; }
form { display: grid; gap: 8px; }
input, textarea, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #d4d4d8; }
button { background: #18181b; color: #fff; border: 0; cursor: pointer; }
button:disabled { opacity: .6; }
.error { color: #b91c1c; }
`,
    'app.js': `const root = document.getElementById('app');

function render(user) {
  root.textContent = '';
  const h = document.createElement('h1');
  h.textContent = user ? 'Signed in as ' + user.email : 'Describe your app to get started';
  root.append(h);
}

App.ready.then(render);
App.auth.onChange(render);
`,
    'README.md': `# Generated full-stack app

Front end: plain HTML, CSS and JavaScript. Backend: declared in \`app.backend.json\` and hosted by the platform
(database, user accounts and access rules). The page talks to it through the \`App\` object the platform injects.
`,
  },
};
