// Row types for the Supabase schema (supabase/migrations/20261014000000_init.sql).

export type WorkspaceType = "team" | "personal";
export type MemberRole = "owner" | "admin" | "member";
export type DocStatus =
  | "draft"
  | "on_modifying"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "rejected"
  | "signing_cancelled"
  | "request_cancelled";
export type RequestType = "sign" | "view";
export type SigningOrder = "sequential" | "parallel";
export type DeliveryMethod = "email" | "kakao" | "in_person";
export type ParticipantStatus = "waiting" | "pending" | "signed" | "viewed" | "rejected";
export type FieldType =
  | "signature"
  | "text"
  | "checkbox"
  | "signed_date"
  | "date"
  | "dropdown"
  | "transcribe"
  | "image";
export type SignatureKind = "sign" | "stamp";

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  name: string;
  department: string | null;
  position: string | null;
  avatar_color: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  type: WorkspaceType;
  owner_id: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: MemberRole;
  is_default: boolean;
  joined_at: string;
}

export interface PageSize {
  w: number;
  h: number;
}

/** documents.attachments item (요청 정보 > 첨부파일) — stored in the `documents` bucket. */
export interface DocumentAttachment {
  name: string;
  /** {workspace_id}/documents/{document_id}/attachments/{uuid}.{ext} */
  path: string;
  size: number;
  type: string;
  uploaded_at: string;
}

/** documents.cc item (요청 정보 > 외부 참조자) — notified on start and completion. */
export interface DocumentCc {
  name: string;
  email: string;
}

export interface DocumentRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  template_id: string | null;
  title: string;
  status: DocStatus;
  request_type: RequestType;
  signing_order: SigningOrder;
  file_name: string | null;
  file_path: string | null;
  completed_file_path: string | null;
  page_count: number;
  page_sizes: PageSize[];
  expires_days: number;
  lock_password: string | null;
  message: string | null;
  label_ids: string[];
  hidden: boolean;
  scheduled_at: string | null;
  requested_at: string | null;
  completed_at: string | null;
  last_activity_at: string;
  created_at: string;
  /** added by migration 20261014013000_wizard (default []) */
  attachments?: DocumentAttachment[];
  /** added by migration 20261014013000_wizard (default []) */
  cc?: DocumentCc[];
  /** added by migration 20261014018000_signer: SHA-256 (hex) of the completed PDF */
  completed_hash?: string | null;
  /** added by migration 20261014018000_signer: storage path of the separate 감사 추적 인증서 PDF */
  audit_file_path?: string | null;
  /** added by migration 20261014030000_security_hardening: claim / last attempt of the completed-PDF generation */
  finalizing_at?: string | null;
  /** added by migration 20261014030000_security_hardening: last generation error (null = none) */
  finalize_error?: string | null;
}

export interface Participant {
  id: string;
  document_id: string;
  order_index: number;
  role: "signer" | "viewer";
  name: string;
  email: string | null;
  phone: string | null;
  delivery: DeliveryMethod | null;
  locale: string;
  status: ParticipantStatus;
  access_token: string;
  auth_password: string | null;
  message: string | null;
  request_attachment: boolean;
  role_label?: string | null;
  reject_reason: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  created_at: string;
  /** added by migration 20261014018000_signer: the signer's 임시저장 values { field_id: value } */
  draft_values?: Record<string, string>;
}

export interface FieldOptions {
  /** signature: 'any' | 'sign' | 'stamp' */
  signMode?: "any" | "sign" | "stamp";
  drawOnly?: boolean;
  uploadOnly?: boolean;
  resizable?: boolean;
  /** signature: 한 번에 서명 허용 (one signature fills all of this signer's signature fields) */
  batchSign?: boolean;
  /** dropdown items */
  items?: string[];
  placeholder?: string;
  defaultText?: string;
  fontSize?: number;
  label?: string;
  /** transcribe (따라쓰기) target sentence */
  sentence?: string;
  /** text fields created from the editor's "자동 입력" tab */
  autoFill?: "name" | "company" | "address";
  /** text input format (입력 형식) */
  format?: "free" | "number" | "email" | "phone";
}

export interface FieldRow {
  id: string;
  document_id: string;
  participant_id: string | null;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options: FieldOptions;
  value: string | null;
  filled_at: string | null;
  created_at: string;
}

export interface DocumentEvent {
  id: string;
  document_id: string;
  type: string;
  actor_name: string | null;
  actor_email: string | null;
  ip: string | null;
  user_agent: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface SignatureRow {
  id: string;
  user_id: string;
  workspace_id: string | null;
  kind: SignatureKind;
  name: string;
  image_data: string;
  is_default: boolean;
  /** stamp shared read-only with the members of `workspace_id` (migration 20261014015000_signature) */
  shared: boolean;
  created_at: string;
}

export interface Label {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface TemplateRole {
  key: string;
  name: string;
  color_index: number;
}

export interface TemplateField {
  role_key: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  options: FieldOptions;
}

export interface TemplateRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  file_path: string | null;
  page_count: number;
  page_sizes: PageSize[];
  request_type: RequestType;
  signing_order: SigningOrder;
  roles: TemplateRole[];
  fields: TemplateField[];
  label_ids: string[];
  pinned: boolean;
  shared: boolean;
  last_modified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  default_channel: "phone" | "email";
  description: string | null;
  company: string | null;
  position: string | null;
  business_no: string | null;
  created_at: string;
}

export interface CustomField {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  type: "text" | "number" | "date" | "checkbox" | "dropdown";
  required: boolean;
  placeholder: string | null;
  default_value: string | null;
  options: string[];
  created_at: string;
}

export interface Approver {
  user_id: string;
  name: string;
  email: string;
  status?: "waiting" | "pending" | "approved" | "rejected";
  comment?: string | null;
  acted_at?: string | null;
}

export interface ApprovalLine {
  id: string;
  workspace_id: string;
  owner_id: string;
  name: string;
  approvers: Approver[];
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  workspace_id: string;
  drafter_id: string;
  title: string;
  file_name: string | null;
  file_path: string | null;
  status: "pending" | "in_progress" | "approved" | "rejected" | "cancelled";
  approvers: Approver[];
  created_at: string;
  last_activity_at: string;
}

export interface BulkSend {
  id: string;
  workspace_id: string;
  owner_id: string;
  template_id: string | null;
  title: string;
  status: "pending" | "sending" | "sent" | "failed";
  recipients: { name: string; email: string; document_id?: string }[];
  created_at: string;
  sent_at: string | null;
}

export interface LinkSign {
  id: string;
  workspace_id: string;
  owner_id: string;
  template_id: string | null;
  title: string;
  token: string;
  active: boolean;
  label_ids: string[];
  created_at: string;
  last_activity_at: string;
}

export interface EditingDocument {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  file_name: string | null;
  file_path: string | null;
  status: "editing" | "done";
  annotations: unknown[];
  created_at: string;
  last_activity_at: string;
}

export interface DraftRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface OutboundEmail {
  id: string;
  document_id: string | null;
  to_email: string;
  to_name: string | null;
  subject: string;
  html: string;
  kind: string;
  delivered: boolean;
  created_at: string;
}
