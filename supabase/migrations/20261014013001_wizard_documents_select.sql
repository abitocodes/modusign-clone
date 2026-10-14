-- =====================================================================
-- documents: additive SELECT policy for workspace members.
--
-- `documents_select` uses can_view_document(id), a SECURITY DEFINER function that re-queries
-- public.documents. During `INSERT … RETURNING` (supabase-js `.insert().select()`) that query
-- cannot see the row being inserted, so the RETURNING check fails with
-- "new row violates row-level security policy". This permissive policy evaluates the new row's
-- own workspace_id instead. It grants nothing new (members can already read the workspace's
-- documents through can_view_document); policies are OR-ed, the existing one is untouched.
-- =====================================================================
drop policy if exists "documents_select_member" on public.documents;
create policy "documents_select_member" on public.documents for select to authenticated
  using (public.is_workspace_member(workspace_id));
