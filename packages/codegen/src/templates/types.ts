export interface TemplateCheck {
  name: string;
  cmd: string[];
}

export interface ProjectTemplate {
  id: string;
  version: number;
  projectTypes: string[];
  description: string;
  install: string[];
  checks: TemplateCheck[];
  preview: { cmd: string[]; readyPath: string };
  /** Rules given to agents that write code for this template. */
  agentGuide: string[];
  files: Record<string, string>;
}
