"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { setVerifiedCookie } from "@/app/sign/[token]/_lib/server";
import { cleanPersonName } from "@/lib/email/address";
import { clientIp } from "@/lib/events";
import { sendDocument } from "@/lib/server/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { PERSON_NAME_MAX, isValidEmail } from "@/lib/templates/model";
import { discardInstantiated, instantiateTemplate } from "@/lib/templates/server";
import type { Participant } from "@/lib/types";

import { loadLink } from "./load";

export interface LinkFormState {
  error: string | null;
  field: "name" | "email" | "agree" | null;
  values: { name: string; email: string };
}

/**
 * Rate-limit key of an address: lower case, "+tag" removed, dots ignored for Gmail — so
 * victim+1@… / v.ictim@gmail.com count as the same mailbox. Delivery uses the typed address.
 */
function rateLimitEmail(email: string) {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at).split("+")[0];
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

const RATE_MESSAGES: Record<string, string> = {
  rate_link: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  rate_daily: "오늘 이 링크로 받을 수 있는 서명 요청이 모두 접수되었습니다. 링크를 전달한 담당자에게 문의해 주세요.",
  rate_email: "같은 이메일로 너무 많이 요청했습니다. 이미 시작한 서명은 이메일로 받은 링크에서 이어서 진행할 수 있습니다.",
  rate_ip: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
};

/**
 * 링크서명 시작 (public, no login): creates a document from the link's template owned by the
 * link creator, with the visitor as the single (pending) participant, sends it (events
 * created + sent, sign-request mail), marks the browser as verified for that participant and
 * opens the signer flow.
 */
export async function startLinkSign(token: string, _prev: LinkFormState, formData: FormData): Promise<LinkFormState> {
  const rawName = String(formData.get("name") ?? "").slice(0, 200);
  // the name ends up in mail headers: no quotes / angle brackets / list separators
  const name = cleanPersonName(rawName, 200);
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 300);
  const agree = formData.get("agree") === "on";
  const values = { name, email };
  const fail = (error: string, field: LinkFormState["field"] = null): LinkFormState => ({ error, field, values });

  if (!name) return fail("이름을 입력해 주세요.", "name");
  if (name.length > PERSON_NAME_MAX) return fail(`이름은 ${PERSON_NAME_MAX}자 이내로 입력해 주세요.`, "name");
  if (!email) return fail("이메일 주소를 입력해 주세요.", "email");
  if (!isValidEmail(email)) return fail("올바른 이메일 주소를 입력해 주세요.", "email");
  if (!agree) return fail("개인정보 수집·이용에 동의해 주세요.", "agree");

  const state = await loadLink(token);
  if (state.kind === "missing") return fail("존재하지 않는 링크입니다.");
  if (state.kind === "inactive") return fail("현재 서명을 받지 않는 링크입니다.");
  if (state.kind === "unavailable") return fail("서명할 문서를 준비할 수 없습니다. 링크를 전달한 담당자에게 문의해 주세요.");
  const { link, template } = state;
  const admin = createAdminClient();

  // abuse guard: a public link must not become a mail cannon. The attempt is reserved atomically
  // (advisory lock per link): 10 per minute, 200 per day, 3 per mailbox / 10 per IP in 10 minutes.
  // Failed attempts count too, so retries cannot get around the limits.
  const ip = clientIp(await headers());
  const { data: verdict, error: rateError } = await admin.rpc("link_sign_reserve", {
    p_link_id: link.id,
    p_email_norm: rateLimitEmail(email),
    p_ip: ip,
  });
  if (rateError) {
    console.error("[link] rate limit unavailable:", rateError.message);
    return fail("서명할 문서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (verdict !== "ok") return fail(RATE_MESSAGES[String(verdict)] ?? RATE_MESSAGES.rate_link);

  const made = await instantiateTemplate({
    db: admin,
    template,
    ownerId: link.owner_id,
    title: link.title,
    labelIds: link.label_ids ?? [],
    linkSignId: link.id,
    people: [{ name, email }],
  });
  if (!made.ok) return fail("서명할 문서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");

  // the link was authorised above (token + active + template); the visitor is the actor
  const sent = await sendDocument(made.documentId, { trusted: true, actor: { name, email } });
  if (!sent.ok) {
    await discardInstantiated(admin, link.workspace_id, made.documentId);
    console.error("[link] send failed:", sent.error);
    return fail("서명할 문서를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  await admin.from("link_signs").update({ last_activity_at: new Date().toISOString() }).eq("id", link.id);

  const { data: me } = await admin.from("participants").select("*").eq("id", made.participants[0].id).single();
  if (!me) return fail("서명 정보를 불러오지 못했습니다. 이메일로 받은 링크에서 서명을 진행해 주세요.");
  // same verification cookie as the /sign identity check → the e-mail check screen is skipped
  try {
    await setVerifiedCookie(me as Participant);
  } catch (e) {
    console.error("[link] identity cookie not issued:", (e as Error).message); // the signer page asks for the e-mail instead
  }

  redirect(`/sign/${(me as Participant).access_token}`);
}
