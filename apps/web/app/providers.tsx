'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ConfirmProvider, TooltipProvider } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <ConfirmProvider>{children}</ConfirmProvider>
        </TooltipProvider>
      </AuthProvider>
      <Toaster
        position="bottom-right"
        offset={16}
        mobileOffset={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
        toastOptions={{ className: '!rounded-[var(--radius-lg)] !border-border !bg-surface !text-fg !shadow-[var(--shadow-lg)] !font-sans' }}
      />
    </QueryClientProvider>
  );
}
