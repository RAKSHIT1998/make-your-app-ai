import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '@/components/composer';
import { ConfirmProvider, StatusBadge, TooltipProvider, useConfirm } from '@/components/ui';
import { DataTable } from '@/components/ui/table';
import { ApiError, apiFetch } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TooltipProvider><ConfirmProvider>{ui}</ConfirmProvider></TooltipProvider></QueryClientProvider>);
}

describe('Composer', () => {
  beforeEach(() => {
    // Billing/estimate queries fail closed in tests; the composer must still render honestly.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
  });

  it('only enables project types that are live and requires a real description', () => {
    wrap(<Composer />);
    const website = screen.getByRole('radio', { name: /^Website/ });
    expect((website as HTMLButtonElement).disabled).toBe(false);
    const mobile = screen.getByRole('radio', { name: /SaaS Platform/ });
    expect((mobile as HTMLButtonElement).disabled).toBe(true);
    expect(mobile.textContent?.toLowerCase()).toContain('soon');

    const generate = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Describe your idea. We'll turn it into a working product."), { target: { value: 'A portfolio site for a wedding photographer' } });
    expect(generate.disabled).toBe(false);
  });

  it('can be limited to a studio’s project types', () => {
    wrap(<Composer types={['website', 'business_website']} />);
    expect(screen.queryByRole('radio', { name: /Mobile App/ })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });
});

describe('useConfirm', () => {
  it('resolves with the typed value only when confirmed', async () => {
    let result: { ok: boolean; value: string } | undefined;
    function Asker() {
      const confirm = useConfirm();
      return <button onClick={async () => { result = await confirm({ title: 'Rename', confirmLabel: 'Save', input: { label: 'Name', defaultValue: 'Old', required: true } }); }}>ask</button>;
    }
    wrap(<Asker />);
    fireEvent.click(screen.getByText('ask'));
    const input = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(input.value).toBe('Old');
    fireEvent.change(input, { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(result).toEqual({ ok: true, value: 'New name' }));
  });
});

describe('DataTable', () => {
  it('renders rows and an empty state', () => {
    const cols = [{ key: 'n', header: 'Name', cell: (r: { n: string }) => r.n }];
    const { rerender } = render(<DataTable rows={[{ n: 'Alpha' }]} rowKey={(r) => r.n} columns={cols} mobile={{ primary: (r) => r.n }} />);
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    rerender(<DataTable rows={[]} rowKey={(r: { n: string }) => r.n} columns={cols} mobile={{ primary: (r) => r.n }} empty={<p>Nothing here</p>} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});

describe('StatusBadge', () => {
  it('renders readable labels', () => {
    render(<StatusBadge status="awaiting_approval" />);
    expect(screen.getByText('Needs approval')).toBeTruthy();
  });
});

describe('apiFetch', () => {
  it('sends the bearer token and surfaces API error messages', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'Not enough credits' }), { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/projects', {}, async () => 'tok123')).rejects.toMatchObject({ status: 402, message: 'Not enough credits' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
    expect(ApiError).toBeDefined();
  });
});
