import type { Metadata } from "next";

import { safeNextPath } from "@/lib/safe-next";

import { LoginForm } from "../auth-form";

export const metadata: Metadata = { title: "로그인 | OpenSign" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? safeNextPath(sp.next) : undefined;
  return <LoginForm next={next} />;
}
