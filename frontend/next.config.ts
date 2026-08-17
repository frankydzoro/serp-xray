import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker: лёгкий запуск собранного приложения (node server.js) без полного node_modules
  output: "standalone",
  async rewrites() {
    // Один origin: /api проксируется на backend. В dev — localhost:8000,
    // в docker-compose — http://backend:8000 (переменная BACKEND_URL).
    // Так CORS в проде не нужен, а ключи API остаются на сервере.
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