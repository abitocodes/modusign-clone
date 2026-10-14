-- =====================================================================
-- 템플릿 / 대량전송 / 링크서명 (templates-bulk-links area)
--
--  * templates: private to the owner until shared ("공유됨"); workspace admins
--    see and manage every template. Only the owner or an admin may change one.
--  * template_pins: per-user "자주 쓰는 템플릿".
--  * bulk_sends: recipients jsonb items
--      { name, email, status: pending|processing|sent|failed, document_id, error,
--        claimed_at?, processed_at? }
--    processed in small batches through bulk_send_claim / bulk_send_report so a
--    batch can be resumed and is never sent twice by concurrent workers.
--  * link_signs: owner/admin manage; documents.link_sign_id remembers which
--    link produced a document (reuse of an unsigned document, rate limiting).
-- =====================================================================

-- ---------------------------------------------------------------------
-- templates
-- ---------------------------------------------------------------------
create index if not exists templates_workspace_idx on public.templates (workspace_id, updated_at desc);

drop policy if exists "templates_select" on public.templates;
drop policy if exists "templates_insert" on public.templates;
drop policy if exists "templates_update" on public.templates;
drop policy if exists "templates_delete" on public.templates;

create policy "templates_select" on public.templates for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (owner_id = auth.uid() or shared or public.is_workspace_admin(workspace_id))
  );
create policy "templates_insert" on public.templates for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "templates_update" on public.templates for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id));
create policy "templates_delete" on public.templates for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

-- ---------------------------------------------------------------------
-- 자주 쓰는 템플릿 (per user)
-- ---------------------------------------------------------------------
create table if not exists public.template_pins (
  template_id uuid not null references public.templates (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, user_id)
);
create index if not exists template_pins_user_idx on public.template_pins (user_id, created_at desc);

alter table public.template_pins enable row level security;

drop policy if exists "template_pins_select" on public.template_pins;
drop policy if exists "template_pins_insert" on public.template_pins;
drop policy if exists "template_pins_delete" on public.template_pins;

create policy "template_pins_select" on public.template_pins for select to authenticated
  using (user_id = auth.uid());
-- the sub-select runs with the caller's RLS → only templates the user can see can be pinned
create policy "template_pins_insert" on public.template_pins for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.templates t where t.id = template_id));
create policy "template_pins_delete" on public.template_pins for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 대량전송
-- ---------------------------------------------------------------------
create index if not exists bulk_sends_workspace_idx on public.bulk_sends (workspace_id, created_at desc);

alter table public.bulk_sends drop constraint if exists bulk_sends_status_check;
alter table public.bulk_sends
  add constraint bulk_sends_status_check check (status in ('pending', 'sending', 'sent', 'failed'));
alter table public.bulk_sends drop constraint if exists bulk_sends_title_check;
alter table public.bulk_sends
  add constraint bulk_sends_title_check check (char_length(btrim(title)) between 1 and 100);

drop policy if exists "bulk_sends_insert" on public.bulk_sends;
drop policy if exists "bulk_sends_update" on public.bulk_sends;
drop policy if exists "bulk_sends_delete" on public.bulk_sends;

create policy "bulk_sends_insert" on public.bulk_sends for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "bulk_sends_update" on public.bulk_sends for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id));
create policy "bulk_sends_delete" on public.bulk_sends for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

-- Counts the recipients and closes a finished batch (sent when ≥1 recipient was sent, else failed).
-- Caller must already hold the row lock (bulk_send_claim / bulk_send_report).
create or replace function public.bulk_send_settle(p_bulk_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.bulk_sends;
  v_total integer;
  v_sent integer;
  v_failed integer;
  v_pending integer;
  v_processing integer;
begin
  select * into v_row from public.bulk_sends where id = p_bulk_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select count(*),
         count(*) filter (where e ->> 'status' = 'sent'),
         count(*) filter (where e ->> 'status' = 'failed'),
         count(*) filter (where coalesce(e ->> 'status', 'pending') = 'pending'),
         count(*) filter (where e ->> 'status' = 'processing')
    into v_total, v_sent, v_failed, v_pending, v_processing
    from jsonb_array_elements(coalesce(v_row.recipients, '[]'::jsonb)) e;

  if v_row.status = 'sending' and v_pending = 0 and v_processing = 0 then
    update public.bulk_sends
       set status = case when v_sent > 0 then 'sent' else 'failed' end,
           sent_at = now()
     where id = p_bulk_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'total', v_total,
    'sent', v_sent,
    'failed', v_failed,
    'pending', v_pending,
    'processing', v_processing
  );
end;
$$;

-- Claims up to p_limit pending recipients (status → processing) of a batch that is still sending.
-- Recipients stuck in processing for 10+ minutes (crashed worker) are marked failed, never re-sent.
-- SECURITY INVOKER + FOR UPDATE: only the owner / an admin (UPDATE policy) can process a batch.
create or replace function public.bulk_send_claim(p_bulk_id uuid, p_limit integer default 5)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.bulk_sends;
  v_items jsonb;
  v_elem jsonb;
  v_status text;
  v_claimed jsonb := '[]'::jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5), 20));
  v_now timestamptz := now();
  v_changed boolean := false;
  i integer;
begin
  select * into v_row from public.bulk_sends where id = p_bulk_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'sending' then
    return v_claimed;
  end if;

  v_items := coalesce(v_row.recipients, '[]'::jsonb);
  for i in 0 .. jsonb_array_length(v_items) - 1 loop
    v_elem := v_items -> i;
    v_status := coalesce(v_elem ->> 'status', 'pending');
    if v_status = 'processing'
       and coalesce((v_elem ->> 'claimed_at')::timestamptz, '-infinity'::timestamptz) < v_now - interval '10 minutes' then
      v_items := jsonb_set(
        v_items, array[i::text],
        (v_elem - 'claimed_at') || jsonb_build_object(
          'status', 'failed',
          'error', '전송 처리가 중단되었습니다. 문서함에서 전송 여부를 확인해 주세요.',
          'processed_at', v_now
        )
      );
      v_changed := true;
    elsif v_status = 'pending' and jsonb_array_length(v_claimed) < v_limit then
      v_items := jsonb_set(v_items, array[i::text], v_elem || jsonb_build_object('status', 'processing', 'claimed_at', v_now));
      v_claimed := v_claimed || jsonb_build_array(
        jsonb_build_object('index', i, 'name', v_elem ->> 'name', 'email', v_elem ->> 'email')
      );
      v_changed := true;
    end if;
  end loop;

  if v_changed then
    update public.bulk_sends set recipients = v_items where id = p_bulk_id;
    perform public.bulk_send_settle(p_bulk_id);
  end if;
  return v_claimed;
end;
$$;

-- Stores the results of claimed recipients: [{ index, status: 'sent'|'failed', document_id?, error? }]
-- and returns the batch summary (closing the batch when nothing is left).
create or replace function public.bulk_send_report(p_bulk_id uuid, p_results jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.bulk_sends;
  v_items jsonb;
  v_res jsonb;
  v_status text;
  v_len integer;
  v_now timestamptz := now();
  i integer;
begin
  select * into v_row from public.bulk_sends where id = p_bulk_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_items := coalesce(v_row.recipients, '[]'::jsonb);
  v_len := jsonb_array_length(v_items);

  for v_res in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    continue when jsonb_typeof(v_res -> 'index') <> 'number';
    i := (v_res ->> 'index')::integer;
    continue when i < 0 or i >= v_len;
    continue when coalesce(v_items -> i ->> 'status', 'pending') <> 'processing';
    v_status := case when v_res ->> 'status' = 'sent' then 'sent' else 'failed' end;
    v_items := jsonb_set(
      v_items, array[i::text],
      ((v_items -> i) - 'claimed_at') || jsonb_build_object(
        'status', v_status,
        'document_id', case when jsonb_typeof(v_res -> 'document_id') = 'string' then v_res -> 'document_id' else 'null'::jsonb end,
        'error', case when v_status = 'failed'
                      then to_jsonb(left(coalesce(nullif(v_res ->> 'error', ''), '전송하지 못했습니다.'), 200))
                      else 'null'::jsonb end,
        'processed_at', v_now
      )
    );
  end loop;

  update public.bulk_sends set recipients = v_items where id = p_bulk_id;
  return public.bulk_send_settle(p_bulk_id);
end;
$$;

revoke all on function public.bulk_send_settle(uuid) from public, anon;
revoke all on function public.bulk_send_claim(uuid, integer) from public, anon;
revoke all on function public.bulk_send_report(uuid, jsonb) from public, anon;
grant execute on function public.bulk_send_settle(uuid) to authenticated;
grant execute on function public.bulk_send_claim(uuid, integer) to authenticated;
grant execute on function public.bulk_send_report(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 링크서명
-- ---------------------------------------------------------------------
create index if not exists link_signs_workspace_idx on public.link_signs (workspace_id, last_activity_at desc);

alter table public.link_signs drop constraint if exists link_signs_title_check;
alter table public.link_signs
  add constraint link_signs_title_check check (char_length(btrim(title)) between 1 and 100);

drop policy if exists "link_signs_insert" on public.link_signs;
drop policy if exists "link_signs_update" on public.link_signs;
drop policy if exists "link_signs_delete" on public.link_signs;

create policy "link_signs_insert" on public.link_signs for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "link_signs_update" on public.link_signs for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id));
create policy "link_signs_delete" on public.link_signs for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

-- documents created by a public link (/link/[token])
alter table public.documents
  add column if not exists link_sign_id uuid references public.link_signs (id) on delete set null;
create index if not exists documents_link_sign_idx
  on public.documents (link_sign_id, created_at desc)
  where link_sign_id is not null;
