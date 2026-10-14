import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";

import { EditingList, type EditingListRow } from "./editing-list";

export const metadata = { title: "문서 편집기 | OpenSign" };

export default async function EditingDocumentsPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/editing-documents">) {
  const { wid } = await params;
  const { profile, role } = await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editing_documents")
    .select("id, owner_id, title, file_name, status, created_at, last_activity_at, owner:profiles(name)")
    .eq("workspace_id", wid)
    .order("last_activity_at", { ascending: false })
    .limit(2000);

  type Raw = Omit<EditingListRow, "owner_name"> & { owner: { name: string } | { name: string }[] | null };
  const rows: EditingListRow[] = ((data ?? []) as unknown as Raw[]).map(({ owner, ...r }) => ({
    ...r,
    owner_name: (Array.isArray(owner) ? owner[0]?.name : owner?.name) ?? "",
  }));

  return (
    <EditingList
      wid={wid}
      rows={rows}
      me={{ id: profile.id, isAdmin: role === "owner" || role === "admin" }}
      loadError={error ? "문서 목록을 불러오지 못했습니다." : null}
    />
  );
}
