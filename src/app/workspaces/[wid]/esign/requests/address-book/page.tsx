import type { Metadata } from "next";

import { getWorkspaceContext } from "@/lib/data/session";
import { createClient } from "@/lib/supabase/server";
import type { Contact } from "@/lib/types";

import { AddressBookView } from "./address-book-view";

export const metadata: Metadata = { title: "주소록 | OpenSign" };

export default async function AddressBookPage({ params }: PageProps<"/workspaces/[wid]/esign/requests/address-book">) {
  const { wid } = await params;
  await getWorkspaceContext(wid);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("workspace_id", wid)
    .order("created_at", { ascending: false });
  if (error) throw new Error("연락처 목록을 불러오지 못했습니다.");
  return <AddressBookView wid={wid} contacts={(data ?? []) as Contact[]} />;
}
