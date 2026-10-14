-- =====================================================================
-- Field editor: replace_document_fields is for logged-in workspace members only.
--
-- Supabase's default privileges grant EXECUTE on new public functions to `anon`
-- as well; `revoke ... from public` in 20261014014001 does not remove that grant.
-- The function already refuses callers that are not workspace members, this just
-- keeps it off the anonymous API surface.
-- =====================================================================
revoke execute on function public.replace_document_fields(uuid, jsonb) from anon;
grant execute on function public.replace_document_fields(uuid, jsonb) to authenticated;
