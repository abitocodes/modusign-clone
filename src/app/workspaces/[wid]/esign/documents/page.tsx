import { redirect } from "next/navigation";

export default async function DocumentsIndex({ params }: PageProps<"/workspaces/[wid]/esign/documents">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/esign/documents/documents?status=all`);
}
