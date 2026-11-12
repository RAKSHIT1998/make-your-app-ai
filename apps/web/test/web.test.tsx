import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypePicker } from '@/components/type-picker';
import { StatusBadge } from '@/components/ui';
import { ApiError, apiFetch } from '@/lib/api';

afterEach(cleanup);

describe('TypePicker', () => {
  it('lets users pick available types and disables ones not live yet', () => {
    const onChange = vi.fn();
    render(<TypePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Website/ }));
    expect(onChange).toHaveBeenCalledWith('website');
    const mobile = screen.getByRole('radio', { name: /Mobile app/ });
    expect((mobile as HTMLButtonElement).disabled).toBe(true);
    expect(mobile.textContent).toContain('Coming soon');
  });
});

describe('StatusBadge', () => {
  it('renders readable labels', () => {
    render(<StatusBadge status="awaiting_approval" />);
    expect(screen.getByText('awaiting approval')).toBeTruthy();
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
