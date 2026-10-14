-- 사인·도장 (signature area)
-- * Admins can share a stamp (e.g. a 법인 도장) with every member of the workspace it was
--   registered in. Shared stamps are read-only for other members; only the owner can change them.
-- * Lookup indexes for the 사인·도장 page and the signer flow ("이용 가능 사인/도장").

alter table public.signatures
  add column if not exists shared boolean not null default false;

alter table public.signatures
  drop constraint if exists signatures_shared_stamp_only;
alter table public.signatures
  add constraint signatures_shared_stamp_only
  check (not shared or (kind = 'stamp' and workspace_id is not null));

create index if not exists signatures_user_kind_idx
  on public.signatures (user_id, kind, created_at desc);

create index if not exists signatures_workspace_shared_idx
  on public.signatures (workspace_id)
  where shared;

-- members of the workspace can read stamps that were shared with it
-- (the existing "signatures_own" policy still governs every write)
drop policy if exists "signatures_shared_select" on public.signatures;
create policy "signatures_shared_select" on public.signatures for select to authenticated
  using (shared and workspace_id is not null and public.is_workspace_member(workspace_id));
