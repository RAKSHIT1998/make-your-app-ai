import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` runs during image builds, where no database settings exist, so the URL is only required by
// commands that actually connect (migrate deploy reads DIRECT_URL at run time and fails clearly if it is missing).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(process.env.DIRECT_URL ? { datasource: { url: process.env.DIRECT_URL } } : {}),
});
