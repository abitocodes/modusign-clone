-- =====================================================================
-- Field editor (wizard step 2): atomic replacement of a document's fields.
--
-- `replace_document_fields(document_id, fields)` deletes every field of a
-- draft / on_modifying document and inserts the given ones in ONE transaction,
-- so a failed save never leaves the document without fields.
--
-- SECURITY INVOKER: the caller's RLS policies apply (documents_select,
-- fields_write). The function additionally checks workspace membership,
-- editability of the document and that every participant belongs to it.
--
-- p_fields: jsonb array of
--   { id?, participant_id, type, page, x, y, width, height, required, options }
-- =====================================================================
create or replace function public.replace_document_fields(p_document_id uuid, p_fields jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_workspace uuid;
  v_status doc_status;
  v_count integer;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'fields must be a json array' using errcode = '22023';
  end if;

  select d.workspace_id, d.status
    into v_workspace, v_status
    from public.documents d
   where d.id = p_document_id;

  if v_workspace is null or not public.is_workspace_member(v_workspace) then
    raise exception 'document not found' using errcode = '42501';
  end if;

  if v_status not in ('draft', 'on_modifying') then
    raise exception 'document is not editable' using errcode = '55000';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_fields) f
     where not exists (
       select 1 from public.participants p
        where p.document_id = p_document_id
          and p.id = nullif(f ->> 'participant_id', '')::uuid
     )
  ) then
    raise exception 'unknown participant' using errcode = '22023';
  end if;

  delete from public.fields where document_id = p_document_id;

  insert into public.fields (id, document_id, participant_id, type, page, x, y, width, height, required, options)
  select coalesce(nullif(f ->> 'id', '')::uuid, gen_random_uuid()),
         p_document_id,
         (f ->> 'participant_id')::uuid,
         (f ->> 'type')::field_type,
         greatest(coalesce((f ->> 'page')::integer, 1), 1),
         greatest((f ->> 'x')::double precision, 0),
         greatest((f ->> 'y')::double precision, 0),
         greatest((f ->> 'width')::double precision, 1),
         greatest((f ->> 'height')::double precision, 1),
         coalesce((f ->> 'required')::boolean, true),
         case when jsonb_typeof(f -> 'options') = 'object' then f -> 'options' else '{}'::jsonb end
    from jsonb_array_elements(p_fields) f;

  get diagnostics v_count = row_count;

  update public.documents set last_activity_at = now() where id = p_document_id;

  return v_count;
end;
$$;

revoke all on function public.replace_document_fields(uuid, jsonb) from public;
grant execute on function public.replace_document_fields(uuid, jsonb) to authenticated;
