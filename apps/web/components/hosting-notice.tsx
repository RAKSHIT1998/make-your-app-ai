'use client';

import Link from 'next/link';
import { Button, Notice } from './ui';

/** Honest states shared by the Cloud Studio pages. */
export function HostingNotConfigured() {
  return (
    <Notice tone="warning">
      <div className="font-medium text-fg">Hosting isn’t connected on this server yet</div>
      Deployments go through the platform’s hosting provider (Vercel). The platform owner adds <code className="font-mono text-xs">HOSTING_PROVIDER=vercel</code> and a <code className="font-mono text-xs">VERCEL_TOKEN</code> to the API environment. Until then, nothing can be deployed — no deployment is ever simulated.
    </Notice>
  );
}

export function HostingUpgrade({ what }: { what: string }) {
  return (
    <Notice action={<Link href="/billing#plans"><Button size="sm" variant="secondary">See plans</Button></Link>}>
      {what}
    </Notice>
  );
}
