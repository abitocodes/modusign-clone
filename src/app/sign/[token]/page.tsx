import type { Metadata } from "next";

import type { SavedSignature } from "@/components/signature";
import { PREVIEW } from "@/lib/preview/flag";
import { paths } from "@/lib/storage";
import { signedUrl } from "@/lib/storage-server";
import type { FieldRow } from "@/lib/types";

import { SignApp } from "./_components/sign-app";
import {
  colorIndexOf,
  identityCheck,
  isDone,
  isExpired,
  isVerified,
  loadSignContext,
  seoulDay,
  sessionEmail,
  type SignContext,
} from "./_lib/server";
import { signDownloadHref, type FilledField, type SignMenu, type SignView } from "./_lib/types";

export const metadata: Metadata = {
  title: "전자서명 | OpenSign",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** pdf.js may fetch byte ranges lazily while the signer keeps the page open */
const PDF_URL_TTL = 60 * 60 * 12;

const toFilled = (f: FieldRow): FilledField => ({
  id: f.id,
  type: f.type,
  page: f.page,
  x: f.x,
  y: f.y,
  width: f.width,
  height: f.height,
  options: { fontSize: f.options?.fontSize },
  value: f.value ?? "",
});

const submitted = (f: FieldRow) => !!f.filled_at && !!f.value;

/**
 * Saved signatures / stamps of the employee account with the invited e-mail (internal signers).
 * Only offered when that employee is logged in in this browser: the e-mail identity check alone
 * (anyone holding the link + address) must never hand out someone's registered signatures.
 */
async function savedSignatures(ctx: SignContext): Promise<{ signs?: SavedSignature[]; stamps?: SavedSignature[] }> {
  const email = ctx.me.email?.trim().toLowerCase();
  if (!email) return {};
  if ((await sessionEmail()) !== email) return {};
  const { data: profile } = await ctx.admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!profile) return {};
  const [{ data: own }, { data: member }] = await Promise.all([
    ctx.admin
      .from("signatures")
      .select("id, kind, image_data, created_at, is_default")
      .eq("user_id", profile.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(24),
    ctx.admin.from("workspace_members").select("user_id").eq("workspace_id", ctx.doc.workspace_id).eq("user_id", profile.id).maybeSingle(),
  ]);
  // stamps an admin shared with the document's workspace (e.g. 법인 도장)
  const { data: shared } = member
    ? await ctx.admin
        .from("signatures")
        .select("id, kind, image_data, created_at, is_default")
        .eq("workspace_id", ctx.doc.workspace_id)
        .eq("kind", "stamp")
        .eq("shared", true)
        .neq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(12)
    : { data: [] };
  const rows = [...(own ?? []), ...(shared ?? [])] as { id: string; kind: string; image_data: string; created_at: string }[];
  const pick = (kind: string) => rows.filter((r) => r.kind === kind).map(({ id, image_data, created_at }) => ({ id, image_data, created_at }));
  return { signs: pick("sign"), stamps: pick("stamp") };
}

async function buildView(token: string): Promise<SignView> {
  const ctx = await loadSignContext(token);
  if (!ctx) return { kind: "message", message: "invalid", view: false };
  const { doc, me } = ctx;
  const view = doc.request_type === "view";

  switch (doc.status) {
    case "draft":
    case "scheduled":
      return { kind: "message", message: "not_sent", view };
    case "on_modifying":
      return { kind: "message", message: "modifying", view };
    case "request_cancelled":
      return { kind: "message", message: "request_cancelled", view };
    case "signing_cancelled":
      return { kind: "message", message: "signing_cancelled", view };
  }
  if (me.status === "rejected") return { kind: "message", message: "rejected_by_me", view, reason: me.reject_reason };
  if (doc.status === "rejected") return { kind: "message", message: "rejected", view };

  const done = isDone(me, doc.request_type);
  if (!done && doc.status !== "completed") {
    if (me.status === "waiting" || !me.sent_at) return { kind: "message", message: "waiting", view };
    if (isExpired(me)) return { kind: "message", message: "expired", view };
  }

  if (!(await isVerified(me))) {
    const check = identityCheck(me) ?? "email";
    return {
      kind: "identity",
      token: me.access_token,
      check,
      needPassword: !!me.auth_password,
      // preview mode (mock backend) only: lets the 본인 확인 shortcut fill in the invited contact
      ...(PREVIEW && {
        preview: {
          contact: check === "email" ? me.email : (me.phone ?? "").replace(/\D/g, "").slice(-4) || null,
          password: me.auth_password,
        },
      }),
    };
  }

  // signed with the service role: the path is rebuilt from the ids, never taken from the row
  const pdfUrl = doc.file_path ? await signedUrl(paths.documentOriginal(doc.workspace_id, doc.id), PDF_URL_TTL) : null;
  const completed = doc.status === "completed";

  if (done || completed) {
    const menu: SignMenu = { canReject: false, downloadHref: signDownloadHref(me.access_token, completed ? "completed" : "current") };
    return {
      kind: "done",
      done: {
        token: me.access_token,
        documentId: doc.id,
        title: doc.title,
        requestType: doc.request_type,
        completed,
        signedAt: me.signed_at ?? me.viewed_at,
        hasCompletedFile: !!doc.completed_file_path,
        preview: pdfUrl ? { pdfUrl, pageSizes: doc.page_sizes ?? [], fields: ctx.fields.filter(submitted).map(toFilled) } : null,
        menu,
      },
    };
  }

  if (!pdfUrl) return { kind: "message", message: "unavailable", view };
  const saved = await savedSignatures(ctx);
  const draft = Object.fromEntries(
    Object.entries(me.draft_values ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
  );

  return {
    kind: "sign",
    doc: {
      token: me.access_token,
      documentId: doc.id,
      title: doc.title,
      requestType: doc.request_type,
      pdfUrl,
      pageSizes: doc.page_sizes ?? [],
      me: { name: me.name, colorIndex: colorIndexOf(ctx), message: me.message, viewed: !!me.viewed_at },
      requester: { name: ctx.owner?.name ?? "요청자", email: ctx.owner?.email ?? "" },
      expiresAt: me.expires_at,
      myFields: ctx.fields
        .filter((f) => f.participant_id === me.id)
        .map((f) => ({
          id: f.id,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
          options: f.options ?? {},
        })),
      otherFields: ctx.fields.filter((f) => f.participant_id !== me.id && submitted(f)).map(toFilled),
      draft,
      savedSigns: saved.signs,
      savedStamps: saved.stamps,
      today: seoulDay(),
      menu: { canReject: !view, downloadHref: signDownloadHref(me.access_token, "current") },
    },
  };
}

/** Public signer page — the link of the sign-request e-mail (token = participants.access_token). */
export default async function SignPage({ params, searchParams }: PageProps<"/sign/[token]">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const view = await buildView(token);
  return <SignApp view={view} autoReject={sp.action === "reject"} />;
}
