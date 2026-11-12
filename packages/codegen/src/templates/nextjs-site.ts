import type { ProjectTemplate } from './types.js';

/** Next.js App Router + Tailwind v4 website template. Bump `version` on any change; projects record the version they started from. */
export const nextjsSiteTemplate: ProjectTemplate = {
  id: 'nextjs-site',
  version: 1,
  projectTypes: ['website', 'business_website'],
  description: 'Next.js (App Router), React, TypeScript, Tailwind CSS. SEO metadata, sitemap and robots included.',
  install: ['npm', 'install', '--include=dev', '--no-audit', '--no-fund', '--loglevel=error'],
  checks: [
    { name: 'typecheck', cmd: ['npx', 'tsc', '--noEmit'] },
    { name: 'build', cmd: ['npx', 'next', 'build'] },
  ],
  preview: { cmd: ['npx', 'next', 'start', '-p', '{PORT}'], readyPath: '/' },
  agentGuide: [
    'Pages live in app/<route>/page.tsx (App Router). Shared components go in components/.',
    'Use Tailwind utility classes. Global styles are in app/globals.css (Tailwind v4: `@import "tailwindcss";`).',
    'Import local modules with the "@/..." alias (maps to project root).',
    'Every page must export `metadata` (title, description). Keep app/sitemap.ts in sync with routes.',
    'Only these packages are installed: next, react, react-dom, tailwindcss. Do not import anything else unless you add it to package.json.',
    'Client components need "use client" as the first line. Server components cannot use hooks.',
    'Use plain <img> or next/image with local files only; no remote image domains are configured.',
  ],
  files: {
    'package.json': JSON.stringify(
      {
        name: 'generated-site',
        version: '0.1.0',
        private: true,
        scripts: { dev: 'next dev', build: 'next build', start: 'next start', typecheck: 'tsc --noEmit' },
        dependencies: { next: '16.4.6', react: '19.3.1', 'react-dom': '19.3.1' },
        devDependencies: {
          '@tailwindcss/postcss': '4.3.5',
          '@types/node': '22.20.5',
          '@types/react': '19.3.0',
          '@types/react-dom': '19.3.0',
          postcss: '8.5.32',
          tailwindcss: '4.3.5',
          typescript: '6.0.3',
        },
      },
      null,
      2,
    ) + '\n',
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'react-jsx',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2,
    ) + '\n',
    'next-env.d.ts': '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    'next.config.ts': "import type { NextConfig } from 'next';\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n",
    'postcss.config.mjs': "export default { plugins: { '@tailwindcss/postcss': {} } };\n",
    '.gitignore': 'node_modules\n.next\nnext-env.d.ts\n*.tsbuildinfo\n.env*\n',
    'app/globals.css': '@import "tailwindcss";\n',
    'lib/site.ts': "export const site = {\n  name: 'My Site',\n  url: 'https://example.com',\n  description: 'Built with Make Your App AI',\n};\n",
    'app/layout.tsx': `import type { Metadata } from 'next';
import './globals.css';
import { site } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: \`%s · \${site.name}\` },
  description: site.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
`,
    'app/page.tsx': `import { site } from '@/lib/site';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">{site.name}</h1>
      <p className="text-lg text-neutral-600">{site.description}</p>
    </main>
  );
}
`,
    'app/sitemap.ts': `import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

const routes = [''];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((r) => ({ url: \`\${site.url}\${r}\`, lastModified: new Date() }));
}
`,
    'app/robots.ts': `import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' }, sitemap: \`\${site.url}/sitemap.xml\` };
}
`,
  },
};
