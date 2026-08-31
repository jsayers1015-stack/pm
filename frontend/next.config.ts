import type { NextConfig } from "next";

// BUILD_STATIC=1 produces the static export that FastAPI serves in the container.
// Without it we are in `next dev`, where /api is proxied to the local backend so
// the browser stays same-origin and session cookies work without CORS.
const isStaticExport = process.env.BUILD_STATIC === "1";

const nextConfig: NextConfig = isStaticExport
  ? {
      output: "export",
      images: { unoptimized: true },
    }
  : {
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: "http://127.0.0.1:8000/api/:path*",
          },
        ];
      },
    };

export default nextConfig;
