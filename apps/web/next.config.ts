import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@mya/shared', '@mya/design-tokens'],
};

export default nextConfig;
