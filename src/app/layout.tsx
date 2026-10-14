import type { Metadata } from "next";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "OpenSign | 전자서명 서비스",
  description: "Next.js + Supabase로 만든 사내 전용 전자서명 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="dark" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--menu)",
              color: "var(--text)",
              border: "1px solid var(--line-strong)",
              boxShadow: "var(--shadow-toast)",
              fontFamily: "var(--font-sans)",
            },
          }}
        />
      </body>
    </html>
  );
}
