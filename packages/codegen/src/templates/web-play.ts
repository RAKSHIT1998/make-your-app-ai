import type { ProjectTemplate } from './types.js';

const j = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/**
 * Static HTML + CSS + vanilla JavaScript. Games (Canvas) and small interactive apps that run entirely in the
 * browser. No build step, no packages, no server: the preview and any static host can run it as-is.
 * Bump `version` on any change.
 */
export const webPlayTemplate: ProjectTemplate = {
  id: 'web-play',
  version: 1,
  projectTypes: ['game', 'custom_software'],
  description:
    'A static HTML5 project (index.html, style.css, app.js) in plain JavaScript. Games use <canvas> and requestAnimationFrame; interactive apps use the DOM. Runs fully in the browser, saves progress to localStorage, needs no server or build step.',
  install: ['node', '--version'],
  checks: [{ name: 'syntax', cmd: ['node', '--check', 'app.js'] }],
  preview: { cmd: ['npx', '--yes', 'serve', '-l', '{PORT}', '.'], readyPath: '/' },
  agentGuide: [
    'This is a static project that runs entirely in the browser: index.html, style.css, app.js (add more .js/.css files only if needed). It is a classic script project, not a module project.',
    'index.html loads scripts with <script src="app.js"></script> (classic scripts, in dependency order, placed before </body>) and styles with <link rel="stylesheet" href="style.css">. NEVER use type="module", import or export.',
    'No network: do not load CDNs, fonts, images or libraries from URLs, and do not call fetch, XMLHttpRequest or WebSocket. Draw art with canvas shapes, CSS, inline SVG or data: URIs. Generate sound with the Web Audio API only after a user gesture.',
    'Games: render with <canvas> sized for phones and desktops (scale to the container, keep the aspect ratio, handle devicePixelRatio and resize). Use requestAnimationFrame with a delta-time loop. Support keyboard AND touch/pointer controls, show on-screen instructions, a score, game over and restart, and pause when the tab is hidden.',
    'Persist the high score or app data in localStorage inside try/catch (it may be unavailable). Never store secrets.',
    'Apps: use semantic HTML, label every control, support keyboard use, visible focus, and a layout that works from 320px wide. Validate user input and show clear empty and error states.',
    'The page must be playable/usable immediately with working buttons: no placeholder handlers, no "coming soon" controls, no fake data presented as real.',
    'Keep the game logic deterministic and readable: a state object, update(dt), render(), and input handlers. Comment only what is not obvious.',
    'Always include <meta name="viewport" content="width=device-width, initial-scale=1"> and a <title>. Respect prefers-reduced-motion for non-essential animation.',
  ],
  files: {
    'package.json': j({ name: 'generated-play', version: '1.0.0', private: true, scripts: { start: 'npx serve .', check: 'node --check app.js' } }),
    'index.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main id="app">
    <h1>My project</h1>
    <canvas id="stage" width="640" height="360" aria-label="Game area"></canvas>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
    'style.css': `* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #111827; color: #f9fafb; }
#app { width: min(100%, 720px); padding: 16px; text-align: center; }
canvas { width: 100%; height: auto; background: #1f2937; border-radius: 12px; touch-action: none; }
`,
    'app.js': `const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#f9fafb';
ctx.font = '20px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.fillText('Describe your game or app to get started', canvas.width / 2, canvas.height / 2);
`,
    'README.md': `# Generated project

Plain HTML, CSS and JavaScript. Open \`index.html\` in a browser, or run \`npx serve .\`.
`,
  },
};
