import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // fonts read from disk by src/lib/pdf/finalize.ts
  outputFileTracingIncludes: {
    "/sign/[token]": ["./public/fonts/*.ttf"],
    "/api/sign/[token]/download": ["./public/fonts/*.ttf"],
    "/api/documents/[docId]/download": ["./public/fonts/*.ttf"],
    "/link/[token]": ["./public/fonts/*.ttf"],
  },
  experimental: {
    serverActions: {
      // PDF 업로드(최대 10MB) + multipart 오버헤드
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
