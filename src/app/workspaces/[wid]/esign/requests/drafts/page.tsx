import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

import { DraftsList, type DraftListRow } from "./drafts-list";

export const metadata = { title: "서식 작성기 | OpenSign" };

export default async function DraftsPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/drafts">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drafts")
    .select("id, owner_id, title, created_at, updated_at, owner:profiles(name)")
    .eq("workspace_id", wid)
    .order("updated_at", { ascending: false })
    .limit(2000);

  type Raw = Omit<DraftListRow, "owner_name"> & { owner: { name: string } | { name: string }[] | null };
  const rows: DraftListRow[] = ((data ?? []) as unknown as Raw[]).map(({ owner, ...r }) => ({
    ...r,
    owner_name: (Array.isArray(owner) ? owner[0]?.name : owner?.name) ?? "",
  }));

  return (
    <DraftsList
      wid={wid}
      rows={rows}
      me={{ id: profile.id, isAdmin: role === "owner" || role === "admin" }}
      loadError={error ? "서식 목록을 불러오지 못했습니다." : null}
    />
  );
}
