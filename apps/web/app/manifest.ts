import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Make Your App AI',
    short_name: 'Make Your App',
    description: 'Build websites, apps and stores with AI.',
    start_url: '/home',
    display: 'standalone',
    background_color: '#FAFAF9',
    theme_color: '#0C0C0B',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
