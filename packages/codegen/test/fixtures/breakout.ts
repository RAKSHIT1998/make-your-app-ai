import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f: string) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8');

/** A real, playable Breakout game used to test the game template end to end. */
export const BREAKOUT = { 'index.html': read('breakout-index.html'), 'style.css': read('breakout-style.css'), 'app.js': read('breakout-app.js') };
