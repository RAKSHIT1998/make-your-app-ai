// Stand-in AI model for the bots: answers each agent role with realistic, fixed output, so every product can be built
// end to end without an AI key and without spending money. The platform code around it (agents, validation, repair,
// credits, versions) is the real thing.
import { readFileSync } from 'node:fs';
import * as site from './fixtures/website.mjs';

const here = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const read = (f) => readFileSync(here(f), 'utf8');
const codegen = (f) => readFileSync(new URL(`../../../packages/codegen/test/fixtures/${f}`, import.meta.url), 'utf8');
const j = JSON.stringify;
const patches = (pairs) => pairs.map(([path, content]) => ({ op: 'update', path, content, reason: '' }));

export const OUTPUT = {
  spec: j(site.SPEC),
  design: j(site.DESIGN),
  website: j({ summary: 'Built the home page with a hero and room list, plus a Rooms page.', patches: [
    { op: 'create', path: 'components/Hero.tsx', content: site.HERO, reason: '' },
    { op: 'create', path: 'lib/rooms.ts', content: site.ROOMS_LIB, reason: '' },
    { op: 'update', path: 'app/page.tsx', content: site.HOME, reason: '' },
    { op: 'create', path: 'app/rooms/page.tsx', content: site.ROOMS_PAGE, reason: '' },
  ] }),
  websiteEdit: j({ summary: 'Added a Penthouse room.', patches: [{ op: 'update', path: 'lib/rooms.ts', content: site.ROOMS_LIB.replace('];', "  { name: 'Penthouse', capacity: 2 },\n];"), reason: '' }] }),
  game: j({ summary: 'Neon Breakout: paddle, ball, bricks, score, lives, best score and restart.', patches: patches([['index.html', read('breakout-index.html')], ['style.css', read('breakout-style.css')], ['app.js', read('breakout-app.js')]]) }),
  fullstack: j({ summary: "Taskly: sign-up and sign-in, private task lists with priorities, done and delete, saved to the app's own database.", patches: patches([['index.html', codegen('tasks-index.html')], ['style.css', codegen('tasks-style.css')], ['app.js', codegen('tasks-app.js')], ['app.backend.json', codegen('tasks-backend.json')]]) }),
  teamApp: j({ summary: 'Team task board: only staff the owner adds can sign in; everyone on the team shares and edits the tasks.', patches: patches([['index.html', codegen('tasks-index.html')], ['style.css', codegen('tasks-style.css')], ['app.js', codegen('tasks-app.js')], ['app.backend.json', JSON.stringify({ auth: { enabled: true, mode: 'team' }, collections: { tasks: { fields: { title: { type: 'string', required: true, max: 120 }, done: { type: 'boolean' }, priority: { type: 'enum', values: ['low', 'normal', 'high'] } }, access: { read: 'users', create: 'users', modify: 'users' } } } }, null, 2)]]) }),
  shop: j({ summary: 'Shop front: product grid with search, cart drawer with quantities, discount code, delivery choice, server totals and secure checkout.', patches: patches([['index.html', read('shop/index.html')], ['style.css', read('shop/style.css')], ['app.js', read('shop/app.js')]]) }),
  mobile: j({ summary: 'Built the café app: menu, hours and a booking request screen.', patches: [
    { op: 'update', path: 'lib/theme.ts', content: "export const theme = {\n  colors: { background: '#F7F3EE', surface: '#FFFFFF', text: '#2B1D14', muted: '#7A6A5E', primary: '#7A3E1D', primaryText: '#FFFFFF', border: '#E6DCD2' },\n  space: (n: number) => n * 4,\n  radius: 14,\n};\n", reason: '' },
    { op: 'create', path: 'lib/data.ts', content: "export const menu = [\n  { name: 'Kahwa', price: '₹120' },\n  { name: 'Masala chai', price: '₹80' },\n  { name: 'Walnut cake (placeholder)', price: '₹180' },\n];\n", reason: '' },
    { op: 'update', path: 'app/index.tsx', content: "import { Link } from 'expo-router';\nimport { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';\nimport { menu } from '@/lib/data';\nimport { theme } from '@/lib/theme';\n\nexport default function Home() {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.title}>Lakeview Café</Text>\n      <FlatList data={menu} keyExtractor={(i) => i.name} renderItem={({ item }) => <View style={styles.row}><Text>{item.name}</Text><Text>{item.price}</Text></View>} />\n      <Link href=\"/book\" asChild><Pressable style={styles.button}><Text style={styles.buttonText}>Request a table</Text></Pressable></Link>\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: { flex: 1, padding: theme.space(6), gap: theme.space(3) },\n  title: { fontSize: 28, fontWeight: '700', color: theme.colors.text },\n  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.space(3) },\n  button: { backgroundColor: theme.colors.primary, padding: theme.space(4), borderRadius: theme.radius, alignItems: 'center' },\n  buttonText: { color: theme.colors.primaryText, fontWeight: '600' },\n});\n", reason: '' },
    { op: 'create', path: 'app/book.tsx', content: "import { Text, View } from 'react-native';\n\nexport default function Book() {\n  return <View style={{ flex: 1, padding: 24 }}><Text>Booking requests are sent to the café by WhatsApp.</Text></View>;\n}\n", reason: '' },
  ] }),
  plan: j({ spec: site.SPEC, questions: [{ id: 'audience', question: 'Who are your main customers?', why: 'Changes the tone and what we feature first.' }], assumptions: ['Photos are placeholders until you upload your own'] }),
  ask: j({ answer: 'The ball starts at a fixed speed and gets about 8% faster each time you clear a level. That logic lives in app.js, in the function that starts a new level.', suggestedPrompt: 'Make the ball 20% slower on the first level' }),
  idea: j({ oneLiner: 'Weekend tool library for neighbours', verdict: 'needs_focus', verdictReason: 'Start with one neighbourhood and one tool category.', targetUsers: ['Renters who rarely need power tools'], problem: 'Buying tools used twice a year is wasteful.', strengths: ['Clear everyday pain'], risks: ['Damage and liability when tools break'], alternativesToResearch: ['Existing tool-lending libraries'], mvpFeatures: ['Browse tools', 'Reserve for a weekend'], monetization: ['Small membership fee'], firstWeekSteps: ['Interview five neighbours'], recommendedType: 'website', buildPrompt: 'A simple site where neighbours browse a tool library and reserve items for a weekend.' }),
};

/** Pick the reply the way a real model would be steered: by the agent's system prompt and the request. */
export function reply(system, user) {
  if (user.includes('FAILTEST')) return 'not json';
  if (system.includes('answering a customer')) return OUTPUT.ask;
  if (system.includes('candid product strategist')) return OUTPUT.idea;
  if (system.includes('All store data comes ONLY through the global Store')) return OUTPUT.shop;
  if (system.includes('app.backend.json declares the backend')) return user.includes('team-only app') ? OUTPUT.teamApp : OUTPUT.fullstack;
  if (system.includes('classic script project')) return OUTPUT.game;
  if (system.includes('React Native primitives')) return OUTPUT.mobile;
  if (system.includes('clarifying questions')) return OUTPUT.plan;
  if (system.includes('Product Architect')) return OUTPUT.spec;
  if (system.includes('UI/UX Designer')) return OUTPUT.design;
  if (user.includes('Apply this change')) return OUTPUT.websiteEdit;
  return OUTPUT.website;
}

export const scriptedProvider = {
  name: 'scripted',
  capabilities: () => ({ structuredOutput: true, maxOutputTokens: 64000 }),
  async complete(model, req) {
    await new Promise((r) => setTimeout(r, 300));
    const text = reply(req.system ?? '', req.messages?.[0]?.content ?? '');
    return { text, provider: 'scripted', model, inputTokens: 4000, outputTokens: 2500, stopReason: 'end_turn', latencyMs: 300 };
  },
};

/** A free provider stand-in whose model answers the owner console's one-call probe. */
export const freeGroq = { name: 'groq', capabilities: () => ({ structuredOutput: false, maxOutputTokens: 8192 }), async complete(model) { return { text: '{"sum": 5}', provider: 'groq', model, inputTokens: 40, outputTokens: 6, stopReason: 'stop', latencyMs: 420 }; } };
