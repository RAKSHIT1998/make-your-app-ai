'use client';

import { Composer } from '@/components/composer';
import { StudioPage } from '@/components/studio';
import { Card } from '@/components/ui';

export default function AppStudioPage() {
  return (
    <StudioPage
      title="App Studio"
      description="iOS and Android apps with React Native (Expo) — generated from a description, refined in conversation, built with your own developer accounts."
      types={['mobile_app']}
      create={<Card><Composer compact types={['mobile_app', 'saas', 'custom_software']} defaultType="mobile_app" /></Card>}
      emptyBody="Describe an app above to create your first one."
      capabilities={[
        { label: 'Generate an Expo app from a description', detail: 'Screens with Expo Router, a shared theme and TypeScript — real React Native code you own.', live: true },
        { label: 'Edit by chatting, with version history', detail: 'Every change is checked and saved as a version you can restore.', live: true },
        { label: 'App settings and release checklist', detail: 'Name, bundle identifiers, version, colours and privacy policy, written to app.json.', live: true },
        { label: 'Download the source', detail: 'A ZIP of your app, ready for `eas build` with your own Expo account.', live: true },
        { label: 'Managed iOS and Android builds (EAS)', detail: 'Cloud builds, build logs and installable test builds from here.', live: false },
        { label: 'App icon and splash image upload', detail: 'Needs file storage; Expo’s default icon is used until then.', live: false },
        { label: 'Live preview on your phone', detail: 'Open the app in Expo Go from a QR code.', live: false },
        { label: 'SaaS platforms and custom software', detail: 'Auth, subscriptions, dashboards and APIs.', live: false },
      ]}
    />
  );
}
