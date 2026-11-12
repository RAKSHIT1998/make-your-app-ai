'use client';

import type { ProjectType } from '@mya/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { TypePicker } from '@/components/type-picker';
import { Button, Card, ErrorNotice, Input, Textarea } from '@/components/ui';
import { api } from '@/lib/api';

function CreateForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [type, setType] = useState<ProjectType | null>(params.get('idea') ? 'website' : null);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState(params.get('idea') ?? '');

  const create = useMutation({
    mutationFn: async () => {
      const project = await api.createProject({ name: name.trim() || 'Untitled project', type: type!, description: idea.trim() });
      await api.generate(project.id, idea.trim());
      return project;
    },
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      router.push(`/projects/${project.id}`);
    },
  });

  const canSubmit = !!type && idea.trim().length >= 10;

  return (
    <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate(); }}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create a project</h1>
        <p className="mt-1 text-muted">Pick what you&apos;re building, then describe it in your own words.</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">1 · What are you building?</h2>
        <TypePicker value={type} onChange={setType} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">2 · Describe your idea</h2>
        <Card className="space-y-4 p-4 md:p-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Project name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grand Lake Hotel" maxLength={80} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Your idea</span>
            <Textarea rows={6} value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={8000} placeholder="Describe who it's for, the pages or features you need, and the look you want. The more specific, the better." />
          </label>
          <p className="text-xs text-subtle">Tip: mention real details (your services, location, tone). We use placeholder text where facts are unknown — we never invent reviews or statistics.</p>
        </Card>
      </section>
      {create.error ? <ErrorNotice error={create.error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={!canSubmit} loading={create.isPending}>Generate project</Button>
      </div>
    </form>
  );
}

export default function CreatePage() {
  return (
    <Suspense>
      <CreateForm />
    </Suspense>
  );
}
