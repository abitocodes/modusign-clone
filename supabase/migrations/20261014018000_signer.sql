-- =====================================================================
-- Signer flow (/sign/[token]) + completed documents
--
-- * documents.completed_hash  — SHA-256 (hex) of the completed PDF (원본 검증키, completion mail)
-- * documents.audit_file_path — storage path of the separate 감사 추적 인증서 PDF
--     {workspace_id}/documents/{document_id}/audit.pdf
-- * participants.draft_values — the signer's 임시저장 values ({ field_id: value }); they are not
--     visible on the document (fields.value is only written when the signer signs).
--
-- All writes of the signer flow go through the server (service role) after the signer was
-- authorised by the access token + identity check, so no new policies are needed: the existing
-- RLS policies of documents / participants stay in force for every other client.
-- =====================================================================

alter table public.documents
  add column if not exists completed_hash text,
  add column if not exists audit_file_path text;

alter table public.participants
  add column if not exists draft_values jsonb not null default '{}'::jsonb;

alter table public.participants
  drop constraint if exists participants_draft_values_object;
alter table public.participants
  add constraint participants_draft_values_object check (jsonb_typeof(draft_values) = 'object');
