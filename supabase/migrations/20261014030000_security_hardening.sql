-- =====================================================================
-- Security hardening
--
--  1. participants: signer secrets (access_token, auth_password, draft_values) are never
--     readable through the API; only the server (service role) sees them.
--  2. participants / fields are writable only by the requester (or a workspace owner/admin)
--     while the document is editable (draft / on_modifying).
--  3. documents: only the requester or an admin may update a document; a trigger limits what
--     user sessions may change (status edges, columns, locked after sending). Only drafts may
--     be deleted.
--  4. document_events are written by the server only (audit trail).
--  5. storage: {wid}/documents/{did}/… objects are immutable for browser sessions once the
--     document left the editable states; completed.pdf / audit.pdf are written by the server only.
--  6. stored storage paths must be the canonical path of their row (service-role code signs /
--     copies them).
--  7. bucket limit sized for generated (completed / audit) PDFs.
--  8. identity-check throttle of the signer flow, kept in the database.
--  9. link-sign (public link) rate limit, reserved atomically.
-- 10. atomic signer / cancel / 내용 수정 transitions (serialised on the document row).
-- 11. my_pending_sign_tokens(): the caller's own pending sign link (replaces reading tokens).
-- 12. single-flight generation of the completed PDF.
-- 13. length guards for rows written directly through the API.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. participants: column privileges
-- ---------------------------------------------------------------------
-- A column-level REVOKE is a no-op while the table-level grant exists, so the table grants are
-- replaced by explicit column lists. DELETE stays (wizard removes participants of a draft).
revoke all on public.participants from anon;
revoke select, insert, update on public.participants from authenticated;

grant select (id, document_id, order_index, role, role_label, name, email, phone, delivery, locale, status,
              message, request_attachment, reject_reason, sent_at, viewed_at, signed_at, expires_at, created_at)
  on public.participants to authenticated;
-- status / access_token / timestamps come from the column defaults or from the server
grant insert (id, document_id, order_index, role, role_label, name, email, phone, delivery, locale,
              message, request_attachment, auth_password)
  on public.participants to authenticated;
grant update (order_index, role, role_label, name, email, phone, delivery, locale,
              message, request_attachment, auth_password)
  on public.participants to authenticated;

-- ---------------------------------------------------------------------
-- 2. participants / fields: writable only while the document is editable
-- ---------------------------------------------------------------------
create or replace function public.can_edit_document(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents d
    where d.id = did
      and d.status in ('draft', 'on_modifying')
      and public.is_workspace_member(d.workspace_id)
      and (d.owner_id = auth.uid() or public.is_workspace_admin(d.workspace_id))
  );
$$;
revoke all on function public.can_edit_document(uuid) from public, anon;
grant execute on function public.can_edit_document(uuid) to authenticated;

drop policy if exists "participants_write" on public.participants;
drop policy if exists "participants_insert" on public.participants;
drop policy if exists "participants_update" on public.participants;
drop policy if exists "participants_delete" on public.participants;
create policy "participants_insert" on public.participants for insert to authenticated
  with check (public.can_edit_document(document_id));
create policy "participants_update" on public.participants for update to authenticated
  using (public.can_edit_document(document_id)) with check (public.can_edit_document(document_id));
create policy "participants_delete" on public.participants for delete to authenticated
  using (public.can_edit_document(document_id));

drop policy if exists "fields_write" on public.fields;
drop policy if exists "fields_insert" on public.fields;
drop policy if exists "fields_update" on public.fields;
drop policy if exists "fields_delete" on public.fields;
create policy "fields_insert" on public.fields for insert to authenticated
  with check (public.can_edit_document(document_id));
create policy "fields_update" on public.fields for update to authenticated
  using (public.can_edit_document(document_id)) with check (public.can_edit_document(document_id));
create policy "fields_delete" on public.fields for delete to authenticated
  using (public.can_edit_document(document_id));

-- ---------------------------------------------------------------------
-- 12 (columns used by the guard below). single-flight completed-PDF generation
-- ---------------------------------------------------------------------
alter table public.documents
  add column if not exists finalizing_at timestamptz,   -- claim / last attempt of finalizeDocument
  add column if not exists finalize_error text;         -- last generation error (null = none)

-- ---------------------------------------------------------------------
-- 3. documents: who may update / delete, and what a user session may change
-- ---------------------------------------------------------------------
drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

drop policy if exists "documents_delete" on public.documents;
create policy "documents_delete" on public.documents for delete to authenticated
  using (owner_id = auth.uid() and status = 'draft');

-- User sessions (auth.uid() set) may only:
--   * create drafts;
--   * edit a draft / on_modifying document (never its identity, request or completion columns);
--   * move draft/on_modifying → scheduled, in_progress/scheduled/on_modifying → request_cancelled,
--     in_progress/scheduled → on_modifying (only while no participant acted);
--   * otherwise change hidden / label_ids / last_activity_at only.
-- Sending, signing, completion and expiry run on the server with the service role (auth.uid() null).
create or replace function public.guard_document_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_free constant text[] := array['status', 'hidden', 'label_ids', 'last_activity_at'];
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.requested_at is not null or new.completed_at is not null
       or new.completed_file_path is not null or new.completed_hash is not null or new.audit_file_path is not null
       or new.link_sign_id is not null or new.finalizing_at is not null or new.finalize_error is not null then
      raise exception 'document_insert_forbidden' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
     or new.owner_id is distinct from old.owner_id or new.template_id is distinct from old.template_id
     or new.created_at is distinct from old.created_at or new.requested_at is distinct from old.requested_at
     or new.completed_at is distinct from old.completed_at or new.completed_file_path is distinct from old.completed_file_path
     or new.completed_hash is distinct from old.completed_hash or new.audit_file_path is distinct from old.audit_file_path
     or new.link_sign_id is distinct from old.link_sign_id or new.finalizing_at is distinct from old.finalizing_at
     or new.finalize_error is distinct from old.finalize_error then
    raise exception 'document_column_forbidden' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status in ('draft', 'on_modifying') and new.status = 'scheduled')
      or (old.status in ('in_progress', 'scheduled', 'on_modifying') and new.status = 'request_cancelled')
      or (old.status in ('in_progress', 'scheduled') and new.status = 'on_modifying')
    ) then
      raise exception 'document_status_forbidden' using errcode = '42501';
    end if;
    if new.status = 'on_modifying' and exists (
      select 1 from public.participants p
      where p.document_id = old.id and (p.status in ('signed', 'viewed', 'rejected') or p.signed_at is not null)
    ) then
      raise exception 'participants_acted' using errcode = '42501';
    end if;
  end if;

  if old.status not in ('draft', 'on_modifying')
     and (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
    raise exception 'document_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_document_change() from public, anon, authenticated;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard
  before insert or update on public.documents
  for each row execute function public.guard_document_change();

-- ---------------------------------------------------------------------
-- 4. document_events: audit trail written by the server only
-- ---------------------------------------------------------------------
drop policy if exists "events_insert" on public.document_events;
revoke insert, update, delete, truncate on public.document_events from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. storage: {wid}/documents/{did}/original.pdf + attachments/*
-- ---------------------------------------------------------------------
create or replace function public.document_file_allowed(p_name text, p_owner_id text, p_action text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_parts text[] := storage.foldername(p_name);
  v_depth integer := coalesce(array_length(storage.foldername(p_name), 1), 0);
  v_file text := storage.filename(p_name);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_wid uuid;
  v_original boolean;
  v_doc public.documents;
begin
  if v_uid is null or v_depth < 3 or v_parts[1] !~* v_uuid or v_parts[3] !~* v_uuid then
    return false;
  end if;
  v_wid := v_parts[1]::uuid;
  v_original := v_depth = 3 and v_file = 'original.pdf';
  -- completed.pdf, audit.pdf and every other name: written by the server (service role) only
  if not (v_original or (v_depth = 4 and v_parts[4] = 'attachments')) then
    return false;
  end if;

  select * into v_doc from public.documents d where d.id = v_parts[3]::uuid and d.workspace_id = v_wid;
  if found then
    if not (public.is_workspace_member(v_wid) and (v_doc.owner_id = v_uid or public.is_workspace_admin(v_wid))) then
      return false;
    end if;
    if p_action = 'delete' and v_original then
      return v_doc.status = 'draft';
    end if;
    return v_doc.status in ('draft', 'on_modifying');
  end if;

  -- no row (yet / any more): the editors upload before the row is created, and drafts are
  -- cleaned up after their row was deleted → only the uploader; server copies (no owner) may be
  -- cleaned up by a member of the workspace
  if p_owner_id is not null then
    return p_owner_id = v_uid::text;
  end if;
  return p_action = 'delete' and public.is_workspace_member(v_wid);
end;
$$;
revoke all on function public.document_file_allowed(text, text, text) from public, anon;
grant execute on function public.document_file_allowed(text, text, text) to authenticated;

drop policy if exists "document_files_insert" on storage.objects;
drop policy if exists "document_files_update" on storage.objects;
drop policy if exists "document_files_delete" on storage.objects;

create policy "document_files_insert" on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'documents'
    or public.document_file_allowed(name, owner_id, 'insert')
  );

create policy "document_files_update" on storage.objects as restrictive for update to authenticated
  using (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'documents'
    or public.document_file_allowed(name, owner_id, 'update')
  )
  with check (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'documents'
    or public.document_file_allowed(name, owner_id, 'update')
  );

create policy "document_files_delete" on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'documents'
    or public.document_file_allowed(name, owner_id, 'delete')
  );

-- ---------------------------------------------------------------------
-- 6. canonical storage paths (NOT VALID: enforced for every new / changed row)
-- ---------------------------------------------------------------------
alter table public.documents drop constraint if exists documents_file_path_canonical;
alter table public.documents add constraint documents_file_path_canonical check (
  file_path is null or file_path = workspace_id::text || '/documents/' || id::text || '/original.pdf'
) not valid;
alter table public.documents drop constraint if exists documents_completed_path_canonical;
alter table public.documents add constraint documents_completed_path_canonical check (
  completed_file_path is null or completed_file_path = workspace_id::text || '/documents/' || id::text || '/completed.pdf'
) not valid;
alter table public.documents drop constraint if exists documents_audit_path_canonical;
alter table public.documents add constraint documents_audit_path_canonical check (
  audit_file_path is null or audit_file_path = workspace_id::text || '/documents/' || id::text || '/audit.pdf'
) not valid;
alter table public.templates drop constraint if exists templates_file_path_canonical;
alter table public.templates add constraint templates_file_path_canonical check (
  file_path is null or file_path = workspace_id::text || '/templates/' || id::text || '.pdf'
) not valid;
alter table public.approvals drop constraint if exists approvals_file_path_canonical;
alter table public.approvals add constraint approvals_file_path_canonical check (
  file_path is null or file_path = workspace_id::text || '/approvals/' || id::text || '.pdf'
) not valid;

-- ---------------------------------------------------------------------
-- 7. bucket limit: originals stay ≤ 10 MB (checked on the server from the object metadata);
--    the completed PDF adds the embedded fonts, signature images and the certificate.
-- ---------------------------------------------------------------------
update storage.buckets set file_size_limit = 31457280 where id = 'documents'; -- 30 MiB

-- ---------------------------------------------------------------------
-- 8. identity-check throttle (signer flow)
-- ---------------------------------------------------------------------
create table if not exists public.participant_identity_attempts (
  participant_id uuid primary key references public.participants (id) on delete cascade,
  failures integer not null default 0,          -- since the last successful check
  total_failures integer not null default 0,    -- since the request was (re)sent
  locked_until timestamptz,                     -- 'infinity' = locked until the requester resends
  last_failed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.participant_identity_attempts enable row level security;
revoke all on public.participant_identity_attempts from anon, authenticated;

-- Atomically records a failed identity check. Exponential back-off from the 5th failure
-- (1, 2, 4 … minutes, at most 24 hours), permanent lock after 20 failures.
-- Returns the new locked_until (null = not locked).
create or replace function public.sign_identity_register_failure(p_participant uuid)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_failures integer;
  v_total integer;
  v_until timestamptz;
begin
  insert into public.participant_identity_attempts as a (participant_id, failures, total_failures, last_failed_at, updated_at)
  values (p_participant, 1, 1, now(), now())
  on conflict (participant_id) do update
    set failures = a.failures + 1,
        total_failures = a.total_failures + 1,
        last_failed_at = now(),
        updated_at = now()
  returning failures, total_failures into v_failures, v_total;

  v_until := case
    when v_total >= 20 then 'infinity'::timestamptz
    when v_failures >= 5 then now() + least(interval '1 minute' * power(2, v_failures - 5), interval '24 hours')
    else null
  end;
  update public.participant_identity_attempts set locked_until = v_until where participant_id = p_participant;
  return v_until;
end;
$$;
revoke all on function public.sign_identity_register_failure(uuid) from public, anon, authenticated;
grant execute on function public.sign_identity_register_failure(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 9. link-sign rate limit
--    (documents.link_sign_id records which public link produced a document; every attempt is
--     reserved here first, so concurrent requests cannot exceed the limits)
-- ---------------------------------------------------------------------
create table if not exists public.link_sign_attempts (
  id bigserial primary key,
  link_id uuid not null references public.link_signs (id) on delete cascade,
  email_norm text not null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists link_sign_attempts_link_idx on public.link_sign_attempts (link_id, created_at desc);
create index if not exists link_sign_attempts_email_idx on public.link_sign_attempts (link_id, email_norm, created_at desc);
alter table public.link_sign_attempts enable row level security;
revoke all on public.link_sign_attempts from anon, authenticated;
revoke all on sequence public.link_sign_attempts_id_seq from anon, authenticated;

-- 'ok' (attempt reserved) | 'rate_link' | 'rate_daily' | 'rate_email' | 'rate_ip'
create or replace function public.link_sign_reserve(p_link_id uuid, p_email_norm text, p_ip text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('link_sign:' || p_link_id::text));
  delete from public.link_sign_attempts where link_id = p_link_id and created_at < now() - interval '2 days';

  if (select count(*) from public.link_sign_attempts
       where link_id = p_link_id and created_at > now() - interval '1 minute') >= 10 then
    return 'rate_link';
  end if;
  if (select count(*) from public.link_sign_attempts
       where link_id = p_link_id and created_at > now() - interval '24 hours') >= 200 then
    return 'rate_daily';
  end if;
  if (select count(*) from public.link_sign_attempts
       where link_id = p_link_id and email_norm = p_email_norm and created_at > now() - interval '10 minutes') >= 3 then
    return 'rate_email';
  end if;
  if p_ip is not null and (select count(*) from public.link_sign_attempts
       where link_id = p_link_id and ip = p_ip and created_at > now() - interval '10 minutes') >= 10 then
    return 'rate_ip';
  end if;

  insert into public.link_sign_attempts (link_id, email_norm, ip) values (p_link_id, p_email_norm, p_ip);
  return 'ok';
end;
$$;
revoke all on function public.link_sign_reserve(uuid, text, text) from public, anon, authenticated;
grant execute on function public.link_sign_reserve(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 10. atomic transitions, serialised on the document row (SELECT … FOR UPDATE)
-- ---------------------------------------------------------------------

-- Signer submits (sign request: signed / view request: viewed) with the values of their fields.
-- Service role only (the signer flow authorises by token + identity cookie first).
-- Returns 'ok' | 'not_found' | 'doc_state' | 'already' | 'expired'.
create or replace function public.sign_submit(p_participant_id uuid, p_values jsonb, p_view boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_doc uuid;
  v_doc_status doc_status;
  v_status participant_status;
  v_expires timestamptz;
begin
  select document_id into v_doc from public.participants where id = p_participant_id;
  if v_doc is null then return 'not_found'; end if;
  select status into v_doc_status from public.documents where id = v_doc for update;
  select status, expires_at into v_status, v_expires from public.participants where id = p_participant_id for update;
  if v_doc_status is distinct from 'in_progress' then return 'doc_state'; end if;
  if v_status is distinct from 'pending' then return 'already'; end if;
  if v_expires is not null and v_expires < now() then return 'expired'; end if;

  update public.fields f
     set value = nullif(v.value, ''), filled_at = now()
    from jsonb_each_text(case when jsonb_typeof(p_values) = 'object' then p_values else '{}'::jsonb end) v
   where f.id = v.key::uuid and f.participant_id = p_participant_id and f.document_id = v_doc;

  if p_view then
    update public.participants
       set status = 'viewed', viewed_at = coalesce(viewed_at, now()), draft_values = '{}'::jsonb
     where id = p_participant_id;
  else
    update public.participants
       set status = 'signed', signed_at = now(), viewed_at = coalesce(viewed_at, now()), draft_values = '{}'::jsonb
     where id = p_participant_id;
  end if;
  update public.documents set last_activity_at = now() where id = v_doc;
  return 'ok';
end;
$$;
revoke all on function public.sign_submit(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.sign_submit(uuid, jsonb, boolean) to service_role;

-- Signer rejects: participant rejected + document rejected in one transaction.
-- Returns 'ok' | 'not_found' | 'doc_state' | 'already' | 'expired'.
create or replace function public.sign_reject(p_participant_id uuid, p_reason text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_doc uuid;
  v_doc_status doc_status;
  v_status participant_status;
  v_expires timestamptz;
begin
  select document_id into v_doc from public.participants where id = p_participant_id;
  if v_doc is null then return 'not_found'; end if;
  select status into v_doc_status from public.documents where id = v_doc for update;
  select status, expires_at into v_status, v_expires from public.participants where id = p_participant_id for update;
  if v_doc_status is distinct from 'in_progress' then return 'doc_state'; end if;
  if v_status is distinct from 'pending' then return 'already'; end if;
  if v_expires is not null and v_expires < now() then return 'expired'; end if;

  update public.participants
     set status = 'rejected', reject_reason = left(p_reason, 500), draft_values = '{}'::jsonb
   where id = p_participant_id;
  update public.documents set status = 'rejected', last_activity_at = now() where id = v_doc;
  return 'ok';
end;
$$;
revoke all on function public.sign_reject(uuid, text) from public, anon, authenticated;
grant execute on function public.sign_reject(uuid, text) to service_role;

-- 서명 요청 취소 (requester or workspace owner/admin): in_progress / scheduled / on_modifying.
-- Returns 'ok' | 'not_found' | 'forbidden' | 'state'.
create or replace function public.doc_cancel_request(p_document_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents;
begin
  if v_uid is null then return 'forbidden'; end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or not public.is_workspace_member(v_doc.workspace_id) then return 'not_found'; end if;
  if v_doc.owner_id <> v_uid and not public.is_workspace_admin(v_doc.workspace_id) then return 'forbidden'; end if;
  if v_doc.status not in ('in_progress', 'scheduled', 'on_modifying') then return 'state'; end if;
  update public.documents set status = 'request_cancelled', last_activity_at = now() where id = p_document_id;
  return 'ok';
end;
$$;
revoke all on function public.doc_cancel_request(uuid) from public, anon;
grant execute on function public.doc_cancel_request(uuid) to authenticated;

-- 내용 수정 (requester or workspace owner/admin): in_progress / scheduled → on_modifying while no
-- participant signed / viewed (view request) / rejected.
-- Returns 'ok' | 'not_found' | 'forbidden' | 'state' | 'acted'.
create or replace function public.doc_start_modify(p_document_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents;
begin
  if v_uid is null then return 'forbidden'; end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or not public.is_workspace_member(v_doc.workspace_id) then return 'not_found'; end if;
  if v_doc.owner_id <> v_uid and not public.is_workspace_admin(v_doc.workspace_id) then return 'forbidden'; end if;
  if v_doc.status not in ('in_progress', 'scheduled') then return 'state'; end if;
  -- separate statement after the lock: sees a signer claim that committed meanwhile
  if exists (
    select 1 from public.participants p
    where p.document_id = p_document_id and (p.status in ('signed', 'viewed', 'rejected') or p.signed_at is not null)
  ) then
    return 'acted';
  end if;
  update public.documents set status = 'on_modifying', last_activity_at = now() where id = p_document_id;
  return 'ok';
end;
$$;
revoke all on function public.doc_start_modify(uuid) from public, anon;
grant execute on function public.doc_start_modify(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. the caller's own pending sign links (logged-in internal signers)
-- ---------------------------------------------------------------------
create or replace function public.my_pending_sign_tokens(p_document_ids uuid[])
returns table (document_id uuid, access_token uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (p.document_id) p.document_id, p.access_token
    from public.participants p
    join public.documents d on d.id = p.document_id
   where p.document_id = any (coalesce(p_document_ids, '{}'::uuid[]))
     and public.current_email() <> ''
     and lower(p.email) = public.current_email()
     and p.status = 'pending'
     and (p.expires_at is null or p.expires_at > now())
     and d.status = 'in_progress'
     and public.can_view_document(d.id)
   order by p.document_id, p.order_index;
$$;
revoke all on function public.my_pending_sign_tokens(uuid[]) from public, anon;
grant execute on function public.my_pending_sign_tokens(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 13. length guards (rows written directly through the API)
-- ---------------------------------------------------------------------
alter table public.drafts drop constraint if exists drafts_content_len;
alter table public.drafts add constraint drafts_content_len check (char_length(content) <= 500000) not valid;
alter table public.participants drop constraint if exists participants_email_len;
alter table public.participants add constraint participants_email_len check (email is null or char_length(email) <= 254) not valid;

notify pgrst, 'reload schema';
