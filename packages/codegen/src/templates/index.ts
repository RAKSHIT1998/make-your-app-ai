import { nextjsSiteTemplate } from './nextjs-site.js';
import { expoAppTemplate } from './expo-app.js';
import { webPlayTemplate } from './web-play.js';
import { fullstackWebTemplate } from './fullstack-web.js';
import type { ProjectTemplate } from './types.js';

export * from './types.js';

const TEMPLATES: ProjectTemplate[] = [nextjsSiteTemplate, expoAppTemplate, webPlayTemplate, fullstackWebTemplate];

export function templateKey(t: ProjectTemplate) {
  return `${t.id}@${t.version}`;
}

export function getTemplate(key: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => templateKey(t) === key);
}

/** The template a new project of this type starts from. Types without a template yet return undefined. */
export function templateForProjectType(type: string): ProjectTemplate | undefined {
  return TEMPLATES.find((t) => t.projectTypes.includes(type));
}

export function treeFromTemplate(t: ProjectTemplate): Map<string, string> {
  return new Map(Object.entries(t.files));
}
