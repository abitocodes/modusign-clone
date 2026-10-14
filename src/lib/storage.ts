/**
 * Storage conventions — bucket `documents` (private).
 *   {workspace_id}/documents/{document_id}/original.pdf
 *   {workspace_id}/documents/{document_id}/completed.pdf
 *   {workspace_id}/templates/{template_id}.pdf
 *   {workspace_id}/approvals/{approval_id}.pdf
 *   {workspace_id}/editing/{id}.pdf
 * Upload from the browser with the user's session (RLS checks workspace membership);
 * read on the server with `signedUrl()` from "@/lib/storage-server".
 */
export const BUCKET = "documents";

export const paths = {
  documentOriginal: (wid: string, did: string) => `${wid}/documents/${did}/original.pdf`,
  documentCompleted: (wid: string, did: string) => `${wid}/documents/${did}/completed.pdf`,
  template: (wid: string, tid: string) => `${wid}/templates/${tid}.pdf`,
  approval: (wid: string, id: string) => `${wid}/approvals/${id}.pdf`,
  editing: (wid: string, id: string) => `${wid}/editing/${id}.pdf`,
};

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
