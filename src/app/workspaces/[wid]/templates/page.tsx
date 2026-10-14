import { redirect } from "next/navigation";

/** /workspaces/[wid]/templates → the template list in 서명 요청. */
export default async function TemplatesIndex({ params }: PageProps<"/workspaces/[wid]/templates">) {
  const { wid } = await params;
  redirect(`/workspaces/${wid}/esign/requests/templates`);
}
