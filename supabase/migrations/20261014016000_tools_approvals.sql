-- =====================================================================
-- 도구(주소록 · 맞춤 입력란) / 결재선 / 내부결재
--   * contacts / custom_fields: integrity checks, 30-per-workspace limit
--   * approval_lines: only the owner (or a workspace admin) may edit/delete
--   * approvals: visible to the drafter and the approvers only; every state
--     transition goes through the security-definer functions below
--   * approval_events: 결재 진행 이력
-- =====================================================================

-- ---------------------------------------------------------------------
-- 주소록 (contacts)
-- ---------------------------------------------------------------------
create index if not exists contacts_workspace_idx on public.contacts (workspace_id, created_at desc);

alter table public.contacts
  add constraint contacts_name_not_blank check (btrim(name) <> ''),
  add constraint contacts_default_channel check (default_channel in ('phone', 'email')),
  add constraint contacts_has_channel check (coalesce(phone, '') <> '' or coalesce(email, '') <> '');

-- ---------------------------------------------------------------------
-- 맞춤 입력란 (custom_fields) — max 30 per workspace, unique names
-- ---------------------------------------------------------------------
create index if not exists custom_fields_workspace_idx on public.custom_fields (workspace_id, created_at);
create unique index if not exists custom_fields_name_uniq on public.custom_fields (workspace_id, lower(name));

alter table public.custom_fields
  add constraint custom_fields_type_check check (type in ('text', 'number', 'date', 'checkbox', 'dropdown')),
  add constraint custom_fields_name_not_blank check (btrim(name) <> '');

create or replace function public.custom_fields_enforce_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('custom_fields:' || new.workspace_id::text));
  if (select count(*) from public.custom_fields where workspace_id = new.workspace_id) >= 30 then
    raise exception 'custom_fields_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists custom_fields_limit on public.custom_fields;
create trigger custom_fields_limit
  before insert on public.custom_fields
  for each row execute function public.custom_fields_enforce_limit();

-- ---------------------------------------------------------------------
-- 결재선 (approval_lines)
-- ---------------------------------------------------------------------
alter table public.approval_lines add column if not exists last_activity_at timestamptz not null default now();
create index if not exists approval_lines_workspace_idx on public.approval_lines (workspace_id, last_activity_at desc);

drop policy if exists "approval_lines_insert" on public.approval_lines;
drop policy if exists "approval_lines_update" on public.approval_lines;
drop policy if exists "approval_lines_delete" on public.approval_lines;

create policy "approval_lines_insert" on public.approval_lines for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "approval_lines_update" on public.approval_lines for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id));
create policy "approval_lines_delete" on public.approval_lines for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

-- ---------------------------------------------------------------------
-- 내부결재 (approvals)
-- ---------------------------------------------------------------------
alter table public.approvals
  add column if not exists message text,
  add column if not exists page_count integer not null default 1,
  add column if not exists line_id uuid references public.approval_lines (id) on delete set null,
  add column if not exists completed_at timestamptz;

alter table public.approvals
  add constraint approvals_status_check check (status in ('pending', 'in_progress', 'approved', 'rejected', 'cancelled'));

create index if not exists approvals_workspace_idx on public.approvals (workspace_id, last_activity_at desc);
create index if not exists approvals_approvers_idx on public.approvals using gin (approvers jsonb_path_ops);

create or replace function public.can_view_approval(aid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.approvals a
    where a.id = aid
      and public.is_workspace_member(a.workspace_id)
      and (a.drafter_id = auth.uid()
           or a.approvers @> jsonb_build_array(jsonb_build_object('user_id', auth.uid()::text)))
  );
$$;

drop policy if exists "approvals_select" on public.approvals;
drop policy if exists "approvals_insert" on public.approvals;
drop policy if exists "approvals_update" on public.approvals;
drop policy if exists "approvals_delete" on public.approvals;

-- drafter + approvers only (no direct insert/update: use approval_submit / approval_decide / approval_cancel)
create policy "approvals_select" on public.approvals for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (drafter_id = auth.uid()
         or approvers @> jsonb_build_array(jsonb_build_object('user_id', auth.uid()::text)))
  );
create policy "approvals_delete" on public.approvals for delete to authenticated
  using (drafter_id = auth.uid() and status in ('rejected', 'cancelled'));

-- 진행 이력
create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.approvals (id) on delete cascade,
  type text not null,               -- submitted | approved | rejected | cancelled | completed
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  actor_email text,
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists approval_events_approval_idx on public.approval_events (approval_id, created_at);

alter table public.approval_events enable row level security;
create policy "approval_events_select" on public.approval_events for select to authenticated
  using (public.can_view_approval(approval_id));

-- ---------------------------------------------------------------------
-- 기안 상신
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
  v_row public.approvals;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'not_member'; end if;
  if char_length(v_title) = 0 or char_length(v_title) > 100 then raise exception 'invalid_title'; end if;
  if v_message is not null and char_length(v_message) > 500 then raise exception 'invalid_message'; end if;
  if p_file_path is null or p_file_path <> (p_workspace_id::text || '/approvals/' || p_id::text || '.pdf') then
    raise exception 'invalid_file';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p_file_path) then
    raise exception 'file_missing';
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

-- ---------------------------------------------------------------------
-- 승인 / 반려 (current approver only, sequential)
-- returns { status, next: approver|null, workspace_id, title, drafter_id }
-- ---------------------------------------------------------------------
create or replace function public.approval_decide(p_id uuid, p_approve boolean, p_comment text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.approvals;
  v_me public.profiles;
  v_idx integer;
  v_len integer;
  v_now timestamptz := now();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_approvers jsonb;
  v_next jsonb := null;
  v_status text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select * into v_row from public.approvals where id = p_id for update;
  if not found or not public.is_workspace_member(v_row.workspace_id) then raise exception 'not_found'; end if;
  if v_row.status not in ('in_progress', 'pending') then raise exception 'not_in_progress'; end if;
  if v_comment is not null and char_length(v_comment) > 500 then raise exception 'invalid_comment'; end if;
  if not p_approve and v_comment is null then raise exception 'comment_required'; end if;

  v_len := jsonb_array_length(v_row.approvers);
  select (t.ord - 1)::integer into v_idx
    from jsonb_array_elements(v_row.approvers) with ordinality as t(elem, ord)
    where t.elem ->> 'status' = 'pending'
    order by t.ord
    limit 1;
  if v_idx is null or (v_row.approvers -> v_idx ->> 'user_id') is distinct from v_uid::text then
    raise exception 'not_your_turn';
  end if;

  v_approvers := jsonb_set(
    v_row.approvers,
    array[v_idx::text],
    (v_row.approvers -> v_idx) || jsonb_build_object(
      'status', case when p_approve then 'approved' else 'rejected' end,
      'comment', v_comment,
      'acted_at', v_now
    )
  );

  if p_approve then
    if v_idx + 1 < v_len then
      v_approvers := jsonb_set(v_approvers, array[(v_idx + 1)::text],
                               (v_approvers -> (v_idx + 1)) || jsonb_build_object('status', 'pending'));
      v_next := v_approvers -> (v_idx + 1);
      v_status := 'in_progress';
    else
      v_status := 'approved';
    end if;
  else
    v_status := 'rejected';
  end if;

  update public.approvals
     set approvers = v_approvers,
         status = v_status,
         last_activity_at = v_now,
         completed_at = case when v_status in ('approved', 'rejected') then v_now else null end
   where id = p_id;

  select * into v_me from public.profiles where id = v_uid;
  insert into public.approval_events (approval_id, type, actor_id, actor_name, actor_email, comment, created_at)
  values (p_id, case when p_approve then 'approved' else 'rejected' end, v_uid, v_me.name, v_me.email, v_comment, v_now);
  if v_status = 'approved' then
    insert into public.approval_events (approval_id, type, created_at) values (p_id, 'completed', v_now);
  end if;

  return jsonb_build_object(
    'status', v_status,
    'next', v_next,
    'workspace_id', v_row.workspace_id,
    'title', v_row.title,
    'drafter_id', v_row.drafter_id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 기안 취소 (drafter, while in progress)
-- ---------------------------------------------------------------------
create or replace function public.approval_cancel(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_row public.approvals;
  v_me public.profiles;
  v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_row from public.approvals where id = p_id for update;
  if not found or v_row.drafter_id <> v_uid then raise exception 'not_found'; end if;
  if v_row.status not in ('in_progress', 'pending') then raise exception 'not_in_progress'; end if;

  update public.approvals
     set status = 'cancelled',
         last_activity_at = v_now,
         completed_at = v_now,
         approvers = coalesce((
           select jsonb_agg(case when t.elem ->> 'status' = 'pending'
                                 then t.elem || jsonb_build_object('status', 'waiting')
                                 else t.elem end order by t.ord)
             from jsonb_array_elements(v_row.approvers) with ordinality as t(elem, ord)
         ), '[]'::jsonb)
   where id = p_id;

  select * into v_me from public.profiles where id = v_uid;
  insert into public.approval_events (approval_id, type, actor_id, actor_name, actor_email, created_at)
  values (p_id, 'cancelled', v_uid, v_me.name, v_me.email, v_now);
end;
$$;

revoke all on function public.approval_submit(uuid, uuid, text, text, text, integer, text, uuid[], uuid) from public, anon;
revoke all on function public.approval_decide(uuid, boolean, text) from public, anon;
revoke all on function public.approval_cancel(uuid) from public, anon;
revoke all on function public.can_view_approval(uuid) from anon;
grant execute on function public.approval_submit(uuid, uuid, text, text, text, integer, text, uuid[], uuid) to authenticated;
grant execute on function public.approval_decide(uuid, boolean, text) to authenticated;
grant execute on function public.approval_cancel(uuid) to authenticated;
