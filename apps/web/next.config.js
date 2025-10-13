import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    forceSwcTransforms: true,
  },
  transpilePackages: ['@cliply/shared'],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@shared': path.resolve('./packages/shared/src'),
    };
    return config;
  },
};

export default nextConfig;
