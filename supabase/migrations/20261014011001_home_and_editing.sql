-- 문서 편집기 (editing_documents) / 서식 작성기 (drafts)
-- Every workspace member may read (and use) these rows, but only the creator or a workspace
-- owner/admin may change or delete them, and a member can only create rows owned by themself.
-- (The init migration allowed any member to update/delete any row; the server actions already
-- enforce these rules, the policies now enforce them for direct API access too.)

drop policy if exists "editing_documents_insert" on public.editing_documents;
drop policy if exists "editing_documents_update" on public.editing_documents;
drop policy if exists "editing_documents_delete" on public.editing_documents;

create policy "editing_documents_insert" on public.editing_documents for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "editing_documents_update" on public.editing_documents for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));
create policy "editing_documents_delete" on public.editing_documents for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));

drop policy if exists "drafts_insert" on public.drafts;
drop policy if exists "drafts_update" on public.drafts;
drop policy if exists "drafts_delete" on public.drafts;

create policy "drafts_insert" on public.drafts for insert to authenticated
  with check (owner_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "drafts_update" on public.drafts for update to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)))
  with check (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));
create policy "drafts_delete" on public.drafts for delete to authenticated
  using (public.is_workspace_member(workspace_id) and (owner_id = auth.uid() or public.is_workspace_admin(workspace_id)));
