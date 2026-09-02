/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,

  // The shared contracts package ships TypeScript sources compiled to ESM;
  // transpiling it here lets the web app import the same Zod schemas the API
  // validates against, so the two cannot drift.
  transpilePackages: ['@postal/shared'],

  /**
   * Proxy the API through the Next.js origin.
   *
   * Same-origin requests mean the refresh cookie is a first-party cookie rather
   * than a third-party one — which browsers increasingly block outright — and
   * the browser never has to preflight a cross-origin request on every call.
   */
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_TARGET}/api/v1/:path*` },
      { source: '/healthz', destination: `${API_TARGET}/healthz` },
      { source: '/readyz', destination: `${API_TARGET}/readyz` },
      { source: '/docs', destination: `${API_TARGET}/docs` },
      { source: '/docs/:path*', destination: `${API_TARGET}/docs/:path*` },
    ];
  },
};

export default nextConfig;
