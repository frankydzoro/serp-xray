import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker: run the built app easily (node server.js) without the full node_modules
  output: "standalone",
  async rewrites() {
    // Single origin: /api is proxied to the backend. In dev — localhost:8000,
    // in docker-compose — http://backend:8000 (the BACKEND_URL variable).
    // This way CORS isn't needed in prod, and API keys stay on the server.
    const backend = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
