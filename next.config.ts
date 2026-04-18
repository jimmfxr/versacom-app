import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Let the bare /docs URL resolve to the static hub HTML. Next.js
      // doesn't auto-serve index.html from nested public/ folders, so
      // without this rule /docs returns a 404.
      { source: "/docs", destination: "/docs/index.html", permanent: false },
    ];
  },
};

export default nextConfig;
