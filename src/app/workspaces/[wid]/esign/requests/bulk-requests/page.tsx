import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { BulkRecipientItem } from "@/lib/templates/model";
import { canManageTemplate, loadTemplateOptions } from "@/lib/templates/server";
import type { BulkSend } from "@/lib/types";

import { BulkView, type BulkListItem } from "./bulk-view";

export const metadata: Metadata = { title: "대량전송 | OpenSign" };

type Row = Omit<BulkSend, "recipients"> & { recipients: BulkRecipientItem[] };

export default async function BulkRequestsPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/bulk-requests">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();

  const [{ data, error }, templates] = await Promise.all([
    supabase
      .from("bulk_sends")
      .select("id, workspace_id, owner_id, template_id, title, status, recipients, created_at, sent_at")
      .eq("workspace_id", wid)
      .order("created_at", { ascending: false })
      .limit(1000),
    loadTemplateOptions(supabase, wid),
  ]);
  if (error) throw new Error("대량전송 목록을 불러오지 못했습니다.");
  const rows = (data ?? []) as Row[];

  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));
  const { data: people } = ownerIds.length ? await supabase.from("profiles").select("id, name").in("id", ownerIds) : { data: [] };
  const names = new Map(((people ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const templateTitles = new Map(templates.map((t) => [t.id, t.title]));

  const items: BulkListItem[] = rows.map((r) => {
    const list = Array.isArray(r.recipients) ? r.recipients : [];
    const count = (s: BulkRecipientItem["status"]) => list.filter((x) => (x.status ?? "pending") === s).length;
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      ownerName: names.get(r.owner_id) ?? null,
      isMine: r.owner_id === profile.id,
      canManage: canManageTemplate(r, profile.id, role),
      templateTitle: r.template_id ? (templateTitles.get(r.template_id) ?? null) : null,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      total: list.length,
      sent: count("sent"),
      failed: count("failed"),
      open: count("pending") + count("processing"),
    };
  });

  return <BulkView wid={wid} items={items} templates={templates} />;
}
