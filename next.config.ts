import type { NextConfig } from "next";

/** same gate as src/lib/preview/flag.ts (`next build` / `next dev` set NODE_ENV before loading this file) */
const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW_MODE === "1" && process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // `npm run dev:preview` (mock backend) builds into .next-preview so it can run next to `npm run dev`
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    // outside preview mode the preview UI and the mock's browser client are replaced by inert
    // stand-ins, so no preview code or copy can reach a production (or normal dev) bundle
    resolveAlias: PREVIEW
      ? {}
      : {
          "@/components/preview": "./src/components/preview/disabled.ts",
          "@/lib/preview/browser-client": "./src/lib/preview/browser-client-disabled.ts",
        },
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
