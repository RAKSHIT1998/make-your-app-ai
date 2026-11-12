'use client';

import type { ProjectDto } from '@mya/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, MoreHorizontal, Pencil } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { projectTypeOption } from './project-types';
import { Button, Menu, MenuItem, StatusBadge, toast, useConfirm } from './ui';

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function ProjectCard({ project }: { project: ProjectDto }) {
  const opt = projectTypeOption(project.type);
  const Icon = opt?.icon;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = () => { for (const k of ['projects', 'billing']) void qc.invalidateQueries({ queryKey: [k] }); };
  const rename = useMutation({ mutationFn: (name: string) => api.renameProject(project.id, name), onSuccess: () => { refresh(); toast.success('Project renamed'); }, onError: (e) => toast.error((e as Error).message) });
  const archive = useMutation({ mutationFn: () => api.archiveProject(project.id), onSuccess: () => { refresh(); toast.success('Project archived'); }, onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="group relative rounded-[var(--radius-lg)] border border-border bg-surface shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-md">
      <Link href={`/projects/${project.id}`} className="block p-4 pr-12">
        <div className="flex items-center gap-3">
          {Icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted text-muted"><Icon className="size-4" aria-hidden /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{project.name}</div>
            <div className="truncate text-xs text-subtle">{opt?.label ?? project.type} · {timeAgo(project.updatedAt)}</div>
          </div>
        </div>
        <div className="mt-3"><StatusBadge status={project.status} /></div>
      </Link>
      <div className="absolute right-2 top-2">
        <Menu trigger={<Button variant="ghost" size="sm" iconOnly aria-label={`Actions for ${project.name}`}><MoreHorizontal className="size-4" /></Button>}>
          <MenuItem icon={<Pencil />} onSelect={async () => { const r = await confirm({ title: 'Rename project', confirmLabel: 'Save', input: { label: 'Name', defaultValue: project.name, required: true } }); if (r.ok) rename.mutate(r.value.trim()); }}>Rename</MenuItem>
          {project.status !== 'archived' && <MenuItem icon={<Archive />} onSelect={async () => { const r = await confirm({ title: `Archive “${project.name}”?`, body: 'The project keeps its code and versions but stops counting toward your plan’s active projects. Unarchiving isn’t available yet.', confirmLabel: 'Archive' }); if (r.ok) archive.mutate(); }}>Archive</MenuItem>}
        </Menu>
      </div>
    </div>
  );
}
