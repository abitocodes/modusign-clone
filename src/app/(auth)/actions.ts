"use server";

import { redirect } from "next/navigation";

import { PREVIEW } from "@/lib/preview/flag";
import { safeNextPath } from "@/lib/safe-next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
}

/** 아이디(사용자명 또는 이메일) → 계정 이메일 */
async function resolveLoginEmail(login: string) {
  if (login.includes("@")) return login.toLowerCase();
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("email").eq("username", login.toLowerCase()).maybeSingle();
  return data?.email ?? null;
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // only same-site paths: a backslash or TAB after the "/" would resolve to another origin
  const next = safeNextPath(formData.get("next"));
  if (!login || !password) return { error: "아이디와 비밀번호를 입력해 주세요." };

  // preview mode (mock backend): an unknown 아이디 is handed on as is — the mock signs in the demo admin
  const email = (await resolveLoginEmail(login)) ?? (PREVIEW ? login.toLowerCase() : null);
  if (!email) return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };

  redirect(next);
}
