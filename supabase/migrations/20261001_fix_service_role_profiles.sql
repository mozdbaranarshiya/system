-- Run this file once in Supabase SQL Editor.
set role postgres;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.profiles to service_role;

select
  has_schema_privilege('service_role', 'public', 'USAGE') as service_schema_usage,
  has_table_privilege('service_role', 'public.profiles', 'SELECT') as service_profiles_select,
  has_table_privilege('service_role', 'public.profiles', 'INSERT') as service_profiles_insert,
  has_table_privilege('service_role', 'public.profiles', 'UPDATE') as service_profiles_update,
  has_table_privilege('service_role', 'public.profiles', 'DELETE') as service_profiles_delete;
