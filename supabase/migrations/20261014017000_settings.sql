-- =====================================================================
-- 통합 설정 (settings area)
--  * groups / group_members (멤버·그룹 > 그룹)
--  * guards that keep roles and login identities admin-controlled
--  * RPCs: owner transfer, role change, 문서 자동 공유, 감사 로그
-- =====================================================================

-- ---------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index groups_workspace_name_key on public.groups (workspace_id, lower(btrim(name)));

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy "groups_select" on public.groups for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "groups_insert" on public.groups for insert to authenticated
  with check (public.is_workspace_admin(workspace_id));
create policy "groups_update" on public.groups for update to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
create policy "groups_delete" on public.groups for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

create policy "group_members_select" on public.group_members for select to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id and public.is_workspace_member(g.workspace_id)));
create policy "group_members_insert" on public.group_members for insert to authenticated
  with check (exists (
    select 1 from public.groups g
    join public.workspace_members m on m.workspace_id = g.workspace_id and m.user_id = group_members.user_id
    where g.id = group_id and public.is_workspace_admin(g.workspace_id)
  ));
create policy "group_members_delete" on public.group_members for delete to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id and public.is_workspace_admin(g.workspace_id)));

-- Leaving a workspace also removes the user from that workspace's groups.
create or replace function public.prune_group_members_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.group_members gm
  using public.groups g
  where gm.group_id = g.id and g.workspace_id = old.workspace_id and gm.user_id = old.user_id;
  return old;
end;
$$;

create trigger workspace_members_prune_groups
  after delete on public.workspace_members
  for each row execute function public.prune_group_members_on_leave();

-- ---------------------------------------------------------------------
-- Guards (only apply to end-user sessions; service role / auth triggers have no auth.uid())
-- ---------------------------------------------------------------------
create or replace function public.guard_workspace_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_wid uuid := coalesce(new.workspace_id, old.workspace_id);
  v_caller member_role;
begin
  if v_uid is null then
    return coalesce(new, old);
  end if;

  select m.role into v_caller from public.workspace_members m where m.workspace_id = v_wid and m.user_id = v_uid;

  if tg_op = 'INSERT' then
    if new.role = 'owner' and v_caller is distinct from 'owner'
       and not (new.user_id = v_uid and exists (
         select 1 from public.workspaces w where w.id = new.workspace_id and w.owner_id = v_uid)) then
      raise exception 'owner_only' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id <> old.workspace_id or new.user_id <> old.user_id then
      raise exception 'immutable_membership' using errcode = '42501';
    end if;
    if new.role is distinct from old.role then
      if v_caller is null or v_caller = 'member' then
        raise exception 'forbidden' using errcode = '42501';
      end if;
      if (new.role = 'owner' or old.role = 'owner') and v_caller <> 'owner' then
        raise exception 'owner_only' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  -- DELETE: skip while the whole workspace is being deleted (cascade)
  if old.role = 'owner' and v_caller is distinct from 'owner'
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger workspace_members_guard
  before insert or update or delete on public.workspace_members
  for each row execute function public.guard_workspace_member_change();

-- 아이디(username)와 이메일은 관리자(서버, service role)만 바꿀 수 있다.
create or replace function public.guard_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.id <> old.id or new.email is distinct from old.email or new.username is distinct from old.username) then
    raise exception 'identity_admin_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_identity
  before update on public.profiles
  for each row execute function public.guard_profile_identity();

-- ---------------------------------------------------------------------
-- RPC: 최고 관리자 변경 (owner only)
-- ---------------------------------------------------------------------
create or replace function public.transfer_workspace_owner(wid uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_type workspace_type;
  v_owner uuid;
begin
  select w.type, w.owner_id into v_type, v_owner from public.workspaces w where w.id = wid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if v_type = 'personal' then
    raise exception 'personal_workspace' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = new_owner) then
    raise exception 'not_member' using errcode = '22023';
  end if;
  if new_owner = v_owner then
    return;
  end if;

  update public.workspace_members set role = 'owner' where workspace_id = wid and user_id = new_owner;
  update public.workspace_members set role = 'admin' where workspace_id = wid and user_id = v_owner and role = 'owner';
  update public.workspaces set owner_id = new_owner where id = wid;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: 역할 변경 (owner/admin; only owners grant/revoke owner; keeps ≥1 owner)
-- ---------------------------------------------------------------------
create or replace function public.set_workspace_member_role(wid uuid, uid uuid, new_role member_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_type workspace_type;
  v_primary uuid;
  v_caller member_role;
  v_old member_role;
begin
  select w.type, w.owner_id into v_type, v_primary from public.workspaces w where w.id = wid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select m.role into v_caller from public.workspace_members m where m.workspace_id = wid and m.user_id = auth.uid();
  if v_caller is null or v_caller = 'member' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_type = 'personal' then
    raise exception 'personal_workspace' using errcode = '22023';
  end if;
  select m.role into v_old from public.workspace_members m where m.workspace_id = wid and m.user_id = uid;
  if v_old is null then
    raise exception 'not_member' using errcode = '22023';
  end if;
  if v_old = new_role then
    return;
  end if;
  if (new_role = 'owner' or v_old = 'owner') and v_caller <> 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if v_old = 'owner' and (select count(*) from public.workspace_members m where m.workspace_id = wid and m.role = 'owner') <= 1 then
    raise exception 'last_owner' using errcode = '22023';
  end if;

  update public.workspace_members set role = new_role where workspace_id = wid and user_id = uid;

  -- workspaces.owner_id (최고 관리자) must always point at an owner
  if v_primary = uid and new_role <> 'owner' then
    update public.workspaces
       set owner_id = (select m.user_id from public.workspace_members m
                        where m.workspace_id = wid and m.role = 'owner' order by m.joined_at limit 1)
     where id = wid;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: 문서 자동 공유
-- workspaces.settings.autoShare = { all: [userId], mine: { <requesterId>: [userId] } }
--  scope = 'all'        → 모든 서명 요청 문서를 공유받는 멤버 (admin)
--  scope = <user uuid>  → 그 멤버가 서명 요청한 문서가 공유되는 멤버 (self or admin)
-- ---------------------------------------------------------------------
create or replace function public.set_auto_share(wid uuid, scope text, user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_settings jsonb;
  v_auto jsonb;
  v_ids jsonb;
  v_target uuid;
begin
  if auth.uid() is null or not public.is_workspace_member(wid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if scope = 'all' then
    if not public.is_workspace_admin(wid) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  else
    v_target := scope::uuid;
    if v_target <> auth.uid() and not public.is_workspace_admin(wid) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if not exists (select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = v_target) then
      raise exception 'not_member' using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(user_ids, 1), 0) > 20 then
    raise exception 'too_many' using errcode = '22023';
  end if;

  -- keep workspace members only, de-duplicated, in the given order
  select coalesce(jsonb_agg(to_jsonb(s.u::text) order by s.ord), '[]'::jsonb) into v_ids
  from (
    select distinct on (t.u) t.u, t.ord
    from unnest(coalesce(user_ids, '{}'::uuid[])) with ordinality as t(u, ord)
    where exists (select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = t.u)
    order by t.u, t.ord
  ) s;

  select w.settings into v_settings from public.workspaces w where w.id = wid for update;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  v_auto := coalesce(v_settings -> 'autoShare', '{}'::jsonb);
  if jsonb_typeof(v_auto) is distinct from 'object' then
    v_auto := '{}'::jsonb;
  end if;
  if jsonb_typeof(v_auto -> 'mine') is distinct from 'object' then
    v_auto := jsonb_set(v_auto, '{mine}', '{}'::jsonb);
  end if;
  if scope = 'all' then
    v_auto := jsonb_set(v_auto, '{all}', v_ids);
  else
    v_auto := jsonb_set(v_auto, array['mine', v_target::text], v_ids);
  end if;

  update public.workspaces set settings = jsonb_set(v_settings, '{autoShare}', v_auto) where id = wid;
  return v_auto;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: 감사 로그 (document_events of the workspace; admins only; RLS applies)
-- ---------------------------------------------------------------------
create or replace function public.workspace_audit_log(
  wid uuid,
  q text default null,
  etype text default null,
  lim integer default 20,
  off integer default 0
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  type text,
  actor_name text,
  actor_email text,
  ip text,
  meta jsonb,
  created_at timestamptz,
  total_count bigint
)
language sql stable set search_path = public as $$
  with p as (
    select nullif(btrim(coalesce(q, '')), '') as term
  ), f as (
    select '%' || replace(replace(replace(p.term, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat, p.term from p
  )
  select e.id, e.document_id, d.title, e.type, e.actor_name, e.actor_email, e.ip, e.meta, e.created_at,
         count(*) over () as total_count
  from public.document_events e
  join public.documents d on d.id = e.document_id
  cross join f
  where d.workspace_id = wid
    and public.is_workspace_admin(wid)
    and (etype is null or etype = '' or e.type = etype)
    and (f.term is null
         or e.actor_name ilike f.pat
         or e.actor_email ilike f.pat
         or d.title ilike f.pat
         or e.ip ilike f.pat)
  order by e.created_at desc, e.id
  limit greatest(1, least(coalesce(lim, 20), 100))
  offset greatest(coalesce(off, 0), 0);
$$;

-- ---------------------------------------------------------------------
-- Service-role helper: before an employee account is deleted, hand the
-- workspace content they own over to another member so it is not cascaded away.
-- Works for every public table that has workspace_id + owner_id/drafter_id.
-- ---------------------------------------------------------------------
create or replace function public.reassign_member_content(wid uuid, from_uid uuid, to_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    join information_schema.columns w
      on w.table_schema = c.table_schema and w.table_name = c.table_name and w.column_name = 'workspace_id'
    where c.table_schema = 'public'
      and c.column_name in ('owner_id', 'drafter_id')
      and c.table_name <> 'workspaces'
  loop
    execute format('update public.%I set %I = $1 where workspace_id = $2 and %I = $3',
                   r.table_name, r.column_name, r.column_name)
      using to_uid, wid, from_uid;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
revoke execute on function public.transfer_workspace_owner(uuid, uuid) from public, anon;
revoke execute on function public.set_workspace_member_role(uuid, uuid, member_role) from public, anon;
revoke execute on function public.set_auto_share(uuid, text, uuid[]) from public, anon;
revoke execute on function public.workspace_audit_log(uuid, text, text, integer, integer) from public, anon;
revoke execute on function public.reassign_member_content(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_workspace_owner(uuid, uuid) to authenticated, service_role;
grant execute on function public.set_workspace_member_role(uuid, uuid, member_role) to authenticated, service_role;
grant execute on function public.set_auto_share(uuid, text, uuid[]) to authenticated, service_role;
grant execute on function public.workspace_audit_log(uuid, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.reassign_member_content(uuid, uuid, uuid) to service_role;

revoke execute on function public.guard_workspace_member_change() from public, anon, authenticated;
revoke execute on function public.guard_profile_identity() from public, anon, authenticated;
revoke execute on function public.prune_group_members_on_leave() from public, anon, authenticated;
