import type { Metadata } from 'next';
import { Landing } from '@/components/marketing/landing';

export const metadata: Metadata = {
  title: { absolute: 'Make Your App AI — Your idea deserves to exist. Build it with AI.' },
  description: 'Describe a website, mobile app or online store in your own words and get real, editable code you own. Publish, deploy and grow it with AI.',
  alternates: { canonical: '/' },
};

export default function Page() {
  return <Landing />;
}
