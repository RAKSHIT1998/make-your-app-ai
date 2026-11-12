import type { DesignSpec, ProductSpec } from '../src/index.js';

export const SPEC: ProductSpec = {
  name: 'Grand Lake Hotel',
  category: 'Hotel website',
  summary: 'A boutique lakeside hotel site with rooms and enquiry details.',
  audience: 'Travellers looking for a lakeside stay',
  pages: [
    { route: '/', title: 'Home', purpose: 'Introduce the hotel', sections: ['Hero', 'Highlights'] },
    { route: '/rooms', title: 'Rooms', purpose: 'List room types', sections: ['Room cards'] },
  ],
  entities: [{ name: 'Room', fields: ['name', 'pricePerNight', 'capacity'] }],
  integrations: [{ name: 'WhatsApp', purpose: 'Enquiries', requiresCustomerConfig: true }],
  securityNotes: ['No personal data collected on the site'],
};

export const DESIGN: DesignSpec = {
  tone: 'Calm, premium, airy',
  palette: { primary: '#0F4C5C', primaryForeground: '#FFFFFF', background: '#FAFAF7', surface: '#FFFFFF', text: '#1B1B1B', muted: '#5B6168', accent: '#E3B505', border: '#E4E4DE' },
  typography: { headingStack: 'ui-serif, Georgia, serif', bodyStack: 'ui-sans-serif, system-ui, sans-serif', scale: 'comfortable' },
  radius: 'lg',
  componentNotes: ['Large hero with headline and CTA'],
};

export const HERO = `type HeroProps = { title: string; subtitle: string };

export function Hero({ title, subtitle }: HeroProps) {
  return (
    <section className="bg-[#0F4C5C] px-6 py-24 text-white">
      <h1 className="font-serif text-5xl">{title}</h1>
      <p className="mt-4 max-w-xl text-lg opacity-90">{subtitle}</p>
    </section>
  );
}
`;

export const HOME = `import type { Metadata } from 'next';
import { Hero } from '@/components/Hero';
import { rooms } from '@/lib/rooms';

export const metadata: Metadata = { title: 'Home', description: 'Boutique lakeside hotel' };

export default function Home() {
  return (
    <main>
      <Hero title="Grand Lake Hotel" subtitle="A quiet stay on the water." />
      <ul className="mx-auto grid max-w-4xl gap-4 p-6">
        {rooms.map((r) => (
          <li key={r.name} className="rounded-lg border p-4">{r.name} · sleeps {r.capacity}</li>
        ))}
      </ul>
    </main>
  );
}
`;

export const ROOMS_LIB = `export interface Room { name: string; capacity: number }
export const rooms: Room[] = [
  { name: 'Lake View Double', capacity: 2 },
  { name: 'Family Suite', capacity: 4 },
];
`;

export const ROOMS_PAGE = `import type { Metadata } from 'next';
import { rooms } from '@/lib/rooms';

export const metadata: Metadata = { title: 'Rooms', description: 'Our rooms' };

export default function RoomsPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-semibold">Rooms</h1>
      {rooms.map((r) => <p key={r.name}>{r.name}</p>)}
    </main>
  );
}
`;
