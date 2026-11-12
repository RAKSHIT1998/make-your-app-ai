import type { ProjectDto } from '@mya/shared';
import Link from 'next/link';
import { Card, StatusBadge } from './ui';
import { projectTypeOption } from './project-types';

export function ProjectCard({ project }: { project: ProjectDto }) {
  const opt = projectTypeOption(project.type);
  const Icon = opt?.icon;
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <Card className="h-full p-4 transition-colors group-hover:border-brand/50">
        <div className="flex items-start gap-3">
          {Icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted text-muted"><Icon className="size-4" aria-hidden /></div>}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{project.name}</div>
            <div className="text-sm text-muted">{opt?.label ?? project.type}</div>
          </div>
          <StatusBadge status={project.status} />
        </div>
        <div className="mt-4 text-xs text-subtle">Updated {new Date(project.updatedAt).toLocaleDateString()}</div>
      </Card>
    </Link>
  );
}
