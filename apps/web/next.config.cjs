const path = require("path");
const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    forceSwcTransforms: true,
    appDir: true,
  },
  transpilePackages: ["@cliply/shared"],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@shared": path.resolve("./packages/shared/src"),
    };
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
