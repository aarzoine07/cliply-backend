const path = require("path");
const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    forceSwcTransforms: true,
  },
  // Remove transpilePackages - package is already compiled to dist/
  webpack: (config) => {
    const sharedDistPath = path.resolve(__dirname, "../../packages/shared/dist");
    const sharedSrcPath = path.resolve(__dirname, "../../packages/shared/src");
    
    // Force webpack to resolve @cliply/shared/* to dist (not src) to avoid bundling TS source
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@shared": sharedSrcPath,
      // Map the package root and common subpaths to dist
      "@cliply/shared$": path.resolve(sharedDistPath, "src/index.js"),
      "@cliply/shared/env$": path.resolve(sharedDistPath, "env.js"),
      // Map src directory to dist/src so any resolution through src/ goes to dist/src/
      [sharedSrcPath]: path.resolve(sharedDistPath, "src"),
    };
    
    // Also ensure symlinks are not followed to prevent resolving back to src
    config.resolve.symlinks = false;
    
    return config;
  },
  env: {
    SENTRY_DSN: process.env.SENTRY_DSN,
  },
};

module.exports = withSentryConfig(nextConfig, {
  org: "cliply",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  disableLogger: true,
  automaticVercelMonitors: true,
});
