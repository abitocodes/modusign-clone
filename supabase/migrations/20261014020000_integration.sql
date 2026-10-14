-- Integration: keep the template role name (e.g. "근로자", "회사") on participants created from a template.
alter table public.participants add column if not exists role_label text;
