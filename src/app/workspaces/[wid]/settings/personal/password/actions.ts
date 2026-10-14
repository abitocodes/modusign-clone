"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { type ActionResult, passwordProblem } from "@/components/settings/shared";
import { createClient } from "@/lib/supabase/server";

export interface ChangePasswordInput {
  current: string;
  next: string;
  confirm: string;
}

/**
 * 비밀번호 변경: verifies the current password on a fresh, non-persisting client
 * (so the user's cookie session is untouched), then updates it through the session client.
 */
export async function changePassword(input: ChangePasswordInput): Promise<ActionResult> {
  const current = String(input?.current ?? "");
  const next = String(input?.next ?? "");
  const confirm = String(input?.confirm ?? "");
  if (!current) return { ok: false, error: "현재 비밀번호를 입력해 주세요." };
  const pErr = passwordProblem(next);
  if (pErr) return { ok: false, error: pErr };
  if (next !== confirm) return { ok: false, error: "새 비밀번호가 일치하지 않습니다." };
  if (next === current) return { ok: false, error: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, error: "로그인이 필요합니다." };

  const verifier = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: verifyErr } = await verifier.auth.signInWithPassword({ email: user.email, password: current });
  if (verifyErr) {
    if (/rate|too many/i.test(verifyErr.message)) return { ok: false, error: "시도 횟수가 많습니다. 잠시 후 다시 시도해 주세요." };
    return { ok: false, error: "현재 비밀번호가 올바르지 않습니다." };
  }
  // drop the verification session only (scope "local" keeps the user's other sessions)
  await verifier.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    if (/different|same/i.test(error.message)) return { ok: false, error: "현재 비밀번호와 다른 비밀번호를 입력해 주세요." };
    if (/weak|password/i.test(error.message)) return { ok: false, error: "비밀번호가 보안 정책에 맞지 않습니다." };
    return { ok: false, error: "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, data: null };
}
