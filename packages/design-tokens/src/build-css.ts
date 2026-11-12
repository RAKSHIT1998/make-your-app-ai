import { writeFileSync } from 'node:fs';
import { toCss } from './index.js';

writeFileSync(new URL('./tokens.css', import.meta.url), `/* Generated from @mya/design-tokens — do not edit. */\n${toCss()}`);
