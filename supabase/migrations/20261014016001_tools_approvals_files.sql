-- =====================================================================
-- 내부결재 PDF 접근 제한 ({workspace_id}/approvals/{approval_id}.pdf)
--   The generic `documents_bucket_*` policies let every workspace member
--   read / overwrite / delete any object of the workspace. 기안 문서 are
--   private to the drafter and the approvers, and must not change after
--   submission, so RESTRICTIVE policies narrow access for this prefix:
--     * submitted file  → read: drafter + approvers (can_view_approval)
--                         write: never · delete: drafter once rejected/cancelled
--     * pending upload  → only the uploader (owner_id), e.g. upload → submit,
--       or clean-up after a failed submit / after the row was deleted
-- =====================================================================

create or replace function public.approval_file_allowed(p_name text, p_owner_id text, p_action text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.approvals;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_row from public.approvals a where a.file_path = p_name limit 1;
  if found then
    if p_action = 'select' then
      return public.can_view_approval(v_row.id);
    elsif p_action = 'delete' then
      return v_row.drafter_id = v_uid and v_row.status in ('rejected', 'cancelled');
    end if;
    return false; -- insert / update: a submitted 기안 file is immutable
  end if;

  -- not submitted (yet): only the member who uploaded it
  return p_owner_id is not null and p_owner_id = v_uid::text;
end;
$$;

revoke all on function public.approval_file_allowed(text, text, text) from public, anon;
grant execute on function public.approval_file_allowed(text, text, text) to authenticated;

drop policy if exists "approval_files_select" on storage.objects;
drop policy if exists "approval_files_insert" on storage.objects;
drop policy if exists "approval_files_update" on storage.objects;
drop policy if exists "approval_files_delete" on storage.objects;

create policy "approval_files_select" on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'approvals'
    or public.approval_file_allowed(name, owner_id, 'select')
  );

create policy "approval_files_insert" on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'approvals'
    or public.approval_file_allowed(name, owner_id, 'insert')
  );

create policy "approval_files_update" on storage.objects as restrictive for update to authenticated
  using (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'approvals'
    or public.approval_file_allowed(name, owner_id, 'update')
  )
  with check (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'approvals'
    or public.approval_file_allowed(name, owner_id, 'update')
  );

create policy "approval_files_delete" on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'documents'
    or (storage.foldername(name))[2] is distinct from 'approvals'
    or public.approval_file_allowed(name, owner_id, 'delete')
  );

-- ---------------------------------------------------------------------
-- 기안 상신: the referenced upload must be the caller's own PDF
-- (same function as 20261014016000, plus owner / mime type / size checks)
-- ---------------------------------------------------------------------
create or replace function public.approval_submit(
  p_id uuid,
  p_workspace_id uuid,
  p_title text,
  p_file_name text,
  p_file_path text,
  p_page_count integer,
  p_message text,
  p_approver_ids uuid[],
  p_line_id uuid default null
) returns public.approvals
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_p public.profiles;
  v_pid uuid;
  v_i integer := 0;
  v_title text := btrim(coalesce(p_title, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_approvers jsonb := '[]'::jsonb;
  v_line uuid := p_line_id;
  v_obj storage.objects;
  v_row public.approvals;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'not_member'; end if;
  if char_length(v_title) = 0 or char_length(v_title) > 100 then raise exception 'invalid_title'; end if;
  if v_message is not null and char_length(v_message) > 500 then raise exception 'invalid_message'; end if;
  if p_file_path is null or p_file_path <> (p_workspace_id::text || '/approvals/' || p_id::text || '.pdf') then
    raise exception 'invalid_file';
  end if;
  select * into v_obj from storage.objects o where o.bucket_id = 'documents' and o.name = p_file_path;
  if not found or v_obj.owner_id is distinct from v_uid::text then
    raise exception 'file_missing';
  end if;
  if coalesce(v_obj.metadata ->> 'mimetype', 'application/pdf') <> 'application/pdf' then
    raise exception 'invalid_file';
  end if;
  if coalesce((v_obj.metadata ->> 'size')::bigint, 0) > 10485760 then
    raise exception 'file_too_large';
  end if;
  if p_approver_ids is null or cardinality(p_approver_ids) = 0 then raise exception 'no_approvers'; end if;
  if cardinality(p_approver_ids) > 10 then raise exception 'too_many_approvers'; end if;
  if (select count(distinct x) from unnest(p_approver_ids) as x) <> cardinality(p_approver_ids) then
    raise exception 'duplicate_approver';
  end if;
  if v_uid = any (p_approver_ids) then raise exception 'self_approver'; end if;

  select * into v_me from public.profiles where id = v_uid;

  foreach v_pid in array p_approver_ids loop
    select p.* into v_p
      from public.profiles p
      join public.workspace_members m on m.user_id = p.id and m.workspace_id = p_workspace_id
      where p.id = v_pid;
    if not found then raise exception 'approver_not_member'; end if;
    v_approvers := v_approvers || jsonb_build_array(jsonb_build_object(
      'user_id', v_p.id,
      'name', v_p.name,
      'email', v_p.email,
      'status', case when v_i = 0 then 'pending' else 'waiting' end,
      'comment', null,
      'acted_at', null
    ));
    v_i := v_i + 1;
  end loop;

  if v_line is not null and not exists (
    select 1 from public.approval_lines l where l.id = v_line and l.workspace_id = p_workspace_id
  ) then
    v_line := null;
  end if;

  insert into public.approvals (id, workspace_id, drafter_id, title, file_name, file_path, page_count, message,
                                status, approvers, line_id, created_at, last_activity_at)
  values (p_id, p_workspace_id, v_uid, v_title, nullif(btrim(coalesce(p_file_name, '')), ''), p_file_path,
          greatest(coalesce(p_page_count, 1), 1), v_message, 'in_progress', v_approvers, v_line, now(), now())
  returning * into v_row;

  if v_line is not null then
    update public.approval_lines set last_activity_at = now() where id = v_line;
  end if;

  insert into public.approval_events (approval_id, type, actor_id, actor_name, actor_email, comment)
  values (p_id, 'submitted', v_uid, v_me.name, v_me.email, v_message);

  return v_row;
end;
$$;

revoke all on function public.approval_submit(uuid, uuid, text, text, text, integer, text, uuid[], uuid) from public, anon;
grant execute on function public.approval_submit(uuid, uuid, text, text, text, integer, text, uuid[], uuid) to authenticated;
