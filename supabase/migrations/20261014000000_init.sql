-- =====================================================================
-- OpenSign — initial schema
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type workspace_type as enum ('team', 'personal');
create type member_role as enum ('owner', 'admin', 'member');
create type doc_status as enum (
  'draft', 'on_modifying', 'scheduled', 'in_progress', 'completed',
  'rejected', 'signing_cancelled', 'request_cancelled'
);
create type request_type as enum ('sign', 'view');
create type signing_order as enum ('sequential', 'parallel');
create type delivery_method as enum ('email', 'kakao', 'in_person');
create type participant_status as enum ('waiting', 'pending', 'signed', 'viewed', 'rejected');
create type field_type as enum (
  'signature', 'text', 'checkbox', 'signed_date', 'date', 'dropdown', 'transcribe', 'image'
);
create type signature_kind as enum ('sign', 'stamp');

-- ---------------------------------------------------------------------
-- Profiles & workspaces
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text unique,                 -- optional login ID (아이디) that maps to the e-mail
  name text not null,
  department text,
  position text,
  avatar_color text not null default '#ffe0b2',
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type workspace_type not null default 'team',
  owner_id uuid not null references public.profiles (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role member_role not null default 'member',
  is_default boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role member_role not null default 'member',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Labels
-- ---------------------------------------------------------------------
create table public.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text not null default '#5991f4',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Templates (document + roles + fields, reusable)
-- ---------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  file_path text,
  page_count integer not null default 1,
  page_sizes jsonb not null default '[]'::jsonb,       -- [{w,h}] in PDF points
  request_type request_type not null default 'sign',
  signing_order signing_order not null default 'sequential',
  roles jsonb not null default '[]'::jsonb,            -- [{key,name,color_index}]
  fields jsonb not null default '[]'::jsonb,           -- [{role_key,type,page,x,y,width,height,required,options}]
  label_ids uuid[] not null default '{}',
  pinned boolean not null default false,
  shared boolean not null default false,
  last_modified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Documents (sign requests)
-- ---------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.templates (id) on delete set null,
  title text not null,
  status doc_status not null default 'draft',
  request_type request_type not null default 'sign',
  signing_order signing_order not null default 'sequential',
  file_name text,
  file_path text,                 -- storage path of the original PDF (bucket: documents)
  completed_file_path text,       -- storage path of the final signed PDF
  page_count integer not null default 1,
  page_sizes jsonb not null default '[]'::jsonb,
  expires_days integer not null default 14,
  lock_password text,
  message text,
  label_ids uuid[] not null default '{}',
  hidden boolean not null default false,
  scheduled_at timestamptz,
  requested_at timestamptz,
  completed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index documents_workspace_idx on public.documents (workspace_id, last_activity_at desc);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  order_index integer not null default 0,
  role text not null default 'signer',          -- signer | viewer
  name text not null default '',
  email text,
  phone text,
  delivery delivery_method,
  locale text not null default 'ko',
  status participant_status not null default 'waiting',
  access_token uuid not null default gen_random_uuid() unique,
  auth_password text,                            -- optional signer password (인증 설정)
  message text,                                  -- 남길 말
  request_attachment boolean not null default false,
  reject_reason text,
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index participants_document_idx on public.participants (document_id, order_index);
create index participants_email_idx on public.participants (lower(email));

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  participant_id uuid references public.participants (id) on delete cascade,
  type field_type not null,
  page integer not null default 1,               -- 1-based
  x double precision not null,                   -- PDF points, from top-left of the page
  y double precision not null,
  width double precision not null,
  height double precision not null,
  required boolean not null default true,
  options jsonb not null default '{}'::jsonb,    -- {signMode, items, placeholder, defaultText, fontSize, label}
  value text,                                    -- filled value (text / ISO date / 'true' / data URL)
  filled_at timestamptz,
  created_at timestamptz not null default now()
);
create index fields_document_idx on public.fields (document_id);

create table public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  type text not null,      -- created | sent | viewed | signed | rejected | completed | cancelled | reminded
  actor_name text,
  actor_email text,
  ip text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index document_events_document_idx on public.document_events (document_id, created_at);

-- Outbound e-mail log (also delivered via SMTP when configured)
create table public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents (id) on delete cascade,
  to_email text not null,
  to_name text,
  subject text not null,
  html text not null,
  kind text not null default 'sign_request',
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Signatures / stamps
-- ---------------------------------------------------------------------
create table public.signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  kind signature_kind not null default 'sign',
  name text not null default '',
  image_data text not null,                      -- PNG data URL
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Tools: contacts (주소록), custom fields (맞춤 입력란)
-- ---------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  default_channel text not null default 'email',   -- phone | email
  description text,
  company text,
  position text,
  business_no text,
  created_at timestamptz not null default now()
);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  type text not null default 'text',              -- text | number | date | checkbox | dropdown
  required boolean not null default false,
  placeholder text,
  default_value text,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 내부결재 / 결재선
-- ---------------------------------------------------------------------
create table public.approval_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  approvers jsonb not null default '[]'::jsonb,    -- [{user_id,name,email}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  drafter_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  file_name text,
  file_path text,
  status text not null default 'pending',          -- pending | in_progress | approved | rejected | cancelled
  approvers jsonb not null default '[]'::jsonb,    -- [{user_id,name,email,status,comment,acted_at}]
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 대량전송 / 링크서명
-- ---------------------------------------------------------------------
create table public.bulk_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.templates (id) on delete set null,
  title text not null,
  status text not null default 'pending',          -- pending | sending | sent | failed
  recipients jsonb not null default '[]'::jsonb,   -- [{name,email,document_id}]
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.link_signs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.templates (id) on delete set null,
  title text not null,
  token uuid not null default gen_random_uuid() unique,
  active boolean not null default true,
  label_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 편집: 문서 편집기 / 서식 작성기
-- ---------------------------------------------------------------------
create table public.editing_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  file_name text,
  file_path text,
  status text not null default 'editing',          -- editing | done
  annotations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default '제목 없는 서식',
  content text not null default '',               -- HTML
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- Helper functions (security definer, bypass RLS safely)
-- =====================================================================
create or replace function public.is_workspace_member(wid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = wid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_admin(wid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = wid and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

create or replace function public.current_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.can_view_document(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.documents d
    where d.id = did and (
      public.is_workspace_member(d.workspace_id)
      or exists (
        select 1 from public.participants p
        where p.document_id = d.id and lower(p.email) = public.current_email() and public.current_email() <> ''
      )
    )
  );
$$;

create or replace function public.shares_workspace_with(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or exists (
    select 1 from public.workspace_members a
    join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

-- New employee account (created by an admin via the auth admin API, or by the seed script)
--  → profile
--  → membership in the company workspace (the first team workspace; created on the very first account)
--  → personal workspace
-- raw_user_meta_data: { name, username?, department?, position?, role?: 'owner'|'admin'|'member', company? }
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_role member_role;
  v_company uuid;
  v_personal uuid;
begin
  v_name := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, email, username, name, department, position)
  values (
    new.id,
    lower(new.email),
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    v_name,
    nullif(new.raw_user_meta_data ->> 'department', ''),
    nullif(new.raw_user_meta_data ->> 'position', '')
  );

  select id into v_company from public.workspaces where type = 'team' order by created_at limit 1;
  if v_company is null then
    insert into public.workspaces (name, type, owner_id)
    values (coalesce(nullif(new.raw_user_meta_data ->> 'company', ''), '사내') || ' 워크스페이스', 'team', new.id)
    returning id into v_company;
    v_role := 'owner';
  else
    v_role := coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'member')::member_role;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, is_default) values (v_company, new.id, v_role, true);

  insert into public.workspaces (name, type, owner_id) values (v_name, 'personal', new.id)
    returning id into v_personal;
  insert into public.workspace_members (workspace_id, user_id, role, is_default) values (v_personal, new.id, 'owner', false);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.labels enable row level security;
alter table public.templates enable row level security;
alter table public.documents enable row level security;
alter table public.participants enable row level security;
alter table public.fields enable row level security;
alter table public.document_events enable row level security;
alter table public.outbound_emails enable row level security;
alter table public.signatures enable row level security;
alter table public.contacts enable row level security;
alter table public.custom_fields enable row level security;
alter table public.approval_lines enable row level security;
alter table public.approvals enable row level security;
alter table public.bulk_sends enable row level security;
alter table public.link_signs enable row level security;
alter table public.editing_documents enable row level security;
alter table public.drafts enable row level security;

-- profiles
create policy "profiles_select" on public.profiles for select to authenticated
  using (public.shares_workspace_with(id));
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces
create policy "workspaces_select" on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
create policy "workspaces_insert" on public.workspaces for insert to authenticated
  with check (owner_id = auth.uid());
create policy "workspaces_update" on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));
create policy "workspaces_delete" on public.workspaces for delete to authenticated
  using (owner_id = auth.uid());

-- workspace_members
create policy "members_select" on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id));
create policy "members_insert" on public.workspace_members for insert to authenticated
  with check (public.is_workspace_admin(workspace_id) or (user_id = auth.uid() and exists (
    select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())));
create policy "members_update" on public.workspace_members for update to authenticated
  using (public.is_workspace_admin(workspace_id) or user_id = auth.uid());
create policy "members_delete" on public.workspace_members for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- workspace_invites
create policy "invites_all" on public.workspace_invites for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

-- generic workspace-scoped tables
do $$
declare t text;
begin
  foreach t in array array['labels','templates','contacts','custom_fields','approval_lines','approvals',
                           'bulk_sends','link_signs','editing_documents','drafts']
  loop
    execute format('create policy "%1$s_select" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id));', t);
    execute format('create policy "%1$s_insert" on public.%1$I for insert to authenticated with check (public.is_workspace_member(workspace_id));', t);
    execute format('create policy "%1$s_update" on public.%1$I for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));', t);
    execute format('create policy "%1$s_delete" on public.%1$I for delete to authenticated using (public.is_workspace_member(workspace_id));', t);
  end loop;
end $$;

-- documents
create policy "documents_select" on public.documents for select to authenticated
  using (public.can_view_document(id));
create policy "documents_insert" on public.documents for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "documents_update" on public.documents for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "documents_delete" on public.documents for delete to authenticated
  using (owner_id = auth.uid() and status in ('draft', 'on_modifying', 'scheduled'));

-- participants / fields: readable by viewers of the doc, writable by workspace members while editing
create policy "participants_select" on public.participants for select to authenticated
  using (public.can_view_document(document_id));
create policy "participants_write" on public.participants for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_workspace_member(d.workspace_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.is_workspace_member(d.workspace_id)));

create policy "fields_select" on public.fields for select to authenticated
  using (public.can_view_document(document_id));
create policy "fields_write" on public.fields for all to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and public.is_workspace_member(d.workspace_id)))
  with check (exists (select 1 from public.documents d where d.id = document_id and public.is_workspace_member(d.workspace_id)));

-- events: read-only for viewers (server inserts with service role)
create policy "events_select" on public.document_events for select to authenticated
  using (public.can_view_document(document_id));
create policy "events_insert" on public.document_events for insert to authenticated
  with check (public.can_view_document(document_id));

-- outbound e-mails: recipients can read their own mails
create policy "emails_select_own" on public.outbound_emails for select to authenticated
  using (lower(to_email) = public.current_email());

-- signatures: own only
create policy "signatures_own" on public.signatures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =====================================================================
-- Storage
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- object path convention: {workspace_id}/{...}
create policy "documents_bucket_select" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy "documents_bucket_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy "documents_bucket_update" on storage.objects for update to authenticated
  using (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy "documents_bucket_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
