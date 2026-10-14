-- 사인·도장 (signature area) — write guards
-- "signatures_own" only checks user_id = auth.uid(), so a member could (through the REST API)
-- attach a row to a workspace they do not belong to, or mark a stamp as shared without being an
-- admin. These RESTRICTIVE policies are AND-ed with the permissive ones for every write:
--   * workspace_id must be NULL or a workspace the user belongs to
--   * shared = true requires an owner/admin of that workspace (matches setSignatureShared)

drop policy if exists "signatures_guard_insert" on public.signatures;
create policy "signatures_guard_insert" on public.signatures
  as restrictive for insert to authenticated
  with check (
    (workspace_id is null or public.is_workspace_member(workspace_id))
    and (not shared or public.is_workspace_admin(workspace_id))
  );

drop policy if exists "signatures_guard_update" on public.signatures;
create policy "signatures_guard_update" on public.signatures
  as restrictive for update to authenticated
  using (true)
  with check (
    (workspace_id is null or public.is_workspace_member(workspace_id))
    and (not shared or public.is_workspace_admin(workspace_id))
  );
