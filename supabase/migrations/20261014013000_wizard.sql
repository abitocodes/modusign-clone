-- =====================================================================
-- Sign-request wizard: reference attachments + external CC recipients
-- =====================================================================

-- [{ name, path, size, type, uploaded_at }] — files stored in the `documents` bucket under
--   {workspace_id}/documents/{document_id}/attachments/{uuid}.{ext}
alter table public.documents
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- [{ name, email }] — 외부 참조자: notified when the request starts and when it completes
alter table public.documents
  add column if not exists cc jsonb not null default '[]'::jsonb;

-- Reference attachments may be office / hwp / archive files: extend the bucket's allowed MIME
-- types (additive — existing PDF/PNG/JPEG uploads keep working; size limit unchanged).
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct t order by t)
  from unnest(
    coalesce(allowed_mime_types, array[]::text[]) || array[
      'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp',
      'application/vnd.hancom.hwpx', 'application/hwp+zip',
      'application/zip', 'application/x-zip-compressed',
      'text/plain', 'text/csv',
      'application/octet-stream'
    ]
  ) as t
)
where id = 'documents' and allowed_mime_types is not null;
