import "server-only";

import { createTransport, type Transporter } from "nodemailer";

import { PREVIEW } from "@/lib/preview/flag";
import { createAdminClient } from "@/lib/supabase/admin";

export interface MailInput {
  to: string;
  toName?: string | null;
  subject: string;
  html: string;
  kind: "sign_request" | "completed" | "rejected" | "cancelled" | "reminder" | "approval" | "other";
  documentId?: string | null;
  /** e.g. the completed PDF and the 감사 추적 인증서 PDF */
  attachments?: { filename: string; content: Uint8Array | Buffer; contentType?: string }[];
}

let transport: Transporter | null | undefined;
function getTransport() {
  if (transport !== undefined) return transport;
  // preview mode (`npm run dev:preview`): never any SMTP — mails are only logged (see /dev/mailbox)
  if (PREVIEW) return (transport = null);
  const host = process.env.SMTP_HOST;
  if (!host) return (transport = null);
  transport = createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

/**
 * Sends an e-mail (SMTP when configured, e.g. local Mailpit) and always records it in
 * public.outbound_emails so it can be inspected at /dev/mailbox. Never throws.
 */
export async function sendMail(input: MailInput): Promise<boolean> {
  let delivered = false;
  const t = getTransport();
  if (t) {
    try {
      // structured address: nodemailer quotes / encodes the display name itself, so a name like
      // `a" <x@evil.test>, "b` can never add recipients to the envelope
      const name = input.toName?.replace(/[\r\n]+/g, " ").trim();
      const info = await t.sendMail({
        from: process.env.SMTP_FROM ?? "OpenSign <no-reply@opensign.local>",
        to: name ? { name, address: input.to } : input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content),
          contentType: a.contentType ?? "application/pdf",
        })),
      });
      delivered = true;
      const envelope = (info?.envelope?.to ?? []).map((a: string) => a.toLowerCase());
      if (envelope.length !== 1 || envelope[0] !== input.to.toLowerCase()) {
        console.error("[mailer] unexpected envelope recipients:", envelope.join(", "), "expected:", input.to);
      }
    } catch (e) {
      console.error("[mailer] SMTP send failed:", (e as Error).message);
    }
  }
  if (PREVIEW) console.info(`[preview] mail (not sent) → ${input.to}: ${input.subject}`);
  try {
    await createAdminClient().from("outbound_emails").insert({
      document_id: input.documentId ?? null,
      to_email: input.to,
      to_name: input.toName ?? null,
      subject: input.subject,
      html: input.html,
      kind: input.kind,
      delivered,
    });
  } catch (e) {
    console.error("[mailer] log failed:", (e as Error).message);
  }
  return delivered;
}

/**
 * Public base URL used in links (mails, sign links): NEXT_PUBLIC_APP_URL if set, otherwise the
 * production domain Vercel exposes at runtime (VERCEL_PROJECT_PRODUCTION_URL), otherwise localhost.
 */
function appBase() {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured !== undefined) return configured;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercelHost ? `https://${vercelHost}` : "http://localhost:3000";
}

export function appUrl(path = "") {
  const base = appBase().replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
