'use client';

import { Smartphone } from 'lucide-react';
import { StudioPage } from '@/components/studio';
import Link from 'next/link';
import { Button, Notice } from '@/components/ui';

export default function AppStudioPage() {
  return (
    <StudioPage
      title="App Studio"
      description="Mobile apps, SaaS platforms and custom software."
      types={['mobile_app', 'saas', 'custom_software']}
      create={
        <Notice action={<Link href="/studio/website"><Button size="sm" variant="secondary">Open Website Studio</Button></Link>}>
          <div className="flex items-start gap-3"><Smartphone className="mt-0.5 size-4 shrink-0" /><div><div className="font-medium text-fg">App generation is in development</div>Mobile apps, SaaS platforms and custom software can't be generated yet. Websites and business sites are available today.</div></div>
        </Notice>
      }
      emptyBody="App projects will appear here once app generation is available."
      capabilities={[
        { label: 'Mobile apps (iOS and Android)', detail: 'React Native apps generated from a description.', live: false },
        { label: 'SaaS platforms', detail: 'Auth, subscriptions and dashboards.', live: false },
        { label: 'Custom software', detail: 'CRMs, internal tools and APIs.', live: false },
        { label: 'Builds and store submission', detail: 'Cloud builds for app stores.', live: false },
      ]}
    />
  );
}
