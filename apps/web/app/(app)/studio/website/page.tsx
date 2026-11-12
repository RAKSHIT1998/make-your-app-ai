'use client';

import { Composer } from '@/components/composer';
import { StudioPage } from '@/components/studio';
import { Card } from '@/components/ui';

export default function WebsiteStudioPage() {
  return (
    <StudioPage
      title="Website Studio"
      description="Websites and business sites, generated from a description and refined in conversation."
      types={['website', 'business_website']}
      create={<Card><Composer compact types={['website', 'business_website']} /></Card>}
      emptyBody="Describe a website above to create your first one."
      capabilities={[
        { label: 'Generate from a description', detail: 'Architect, designer and frontend agents produce a Next.js site with pages and sections.', live: true },
        { label: 'Edit by chatting', detail: 'Ask for changes in plain language; each edit is checked and saved as a version.', live: true },
        { label: 'Code, files and version history', detail: 'Browse every file and restore any earlier version.', live: true },
        { label: 'Approval for destructive edits', detail: 'Deleting files or pages waits for your explicit approval.', live: true },
        { label: 'Live preview', detail: 'See the running site next to the code.', live: false },
        { label: 'Visual editor', detail: 'Click a section to edit text, images and colours directly.', live: false },
        { label: 'Publishing and custom domains', detail: 'Host the site and connect your own domain.', live: false },
      ]}
    />
  );
}
