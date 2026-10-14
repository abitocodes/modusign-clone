import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { SignatureRow } from "@/lib/types";

import { SignaturesView, type SignatureItem } from "./signatures-view";

export const metadata: Metadata = { title: "사인·도장 | OpenSign" };

type Row = Pick<SignatureRow, "id" | "user_id" | "kind" | "name" | "image_data" | "is_default" | "shared" | "created_at">;

export default async function SignaturesPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/signatures">) {
  const { wid } = await params;
  const { profile, workspace, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();

  // RLS: my own rows + stamps shared with workspaces I belong to
  const { data, error } = await supabase
    .from("signatures")
    .select("id, user_id, kind, name, image_data, is_default, shared, created_at")
    .or(`workspace_id.eq.${workspace.id},workspace_id.is.null`)
    .order("created_at", { ascending: false });
  if (error) throw new Error("사인·도장 목록을 불러오지 못했습니다.");

  const rows = (data ?? []) as Row[];
  const ownerIds = [...new Set(rows.filter((r) => r.user_id !== profile.id).map((r) => r.user_id))];
  const owners = new Map<string, string>();
  if (ownerIds.length) {
    const { data: people } = await supabase.from("profiles").select("id, name").in("id", ownerIds);
    for (const p of people ?? []) owners.set(p.id as string, p.name as string);
  }

  const items: SignatureItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    image_data: r.image_data,
    is_default: r.user_id === profile.id && r.is_default,
    shared: r.shared,
    created_at: r.created_at,
    mine: r.user_id === profile.id,
    owner_name: r.user_id === profile.id ? profile.name : (owners.get(r.user_id) ?? "멤버"),
  }));

  return (
    <SignaturesView
      wid={workspace.id}
      items={items}
      myName={profile.name}
      companyName={workspace.type === "team" ? workspace.name.replace(/\s*워크스페이스$/, "").trim() : ""}
      canShare={role === "owner" || role === "admin"}
    />
  );
}
