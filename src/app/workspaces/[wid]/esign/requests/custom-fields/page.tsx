import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { CustomField } from "@/lib/types";

import { CustomFieldsView } from "./custom-fields-view";

export const metadata: Metadata = { title: "맞춤 입력란 | OpenSign" };

export default async function CustomFieldsPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/custom-fields">) {
  const { wid } = await params;
  await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("workspace_id", wid)
    .order("created_at", { ascending: true });
  if (error) throw new Error("맞춤 입력란을 불러오지 못했습니다.");
  return <CustomFieldsView wid={wid} fields={(data ?? []) as CustomField[]} />;
}
