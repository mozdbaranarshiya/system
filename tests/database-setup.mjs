import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function database() {
  const db = new PGlite({extensions:{pgcrypto}});
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  `);
  await db.exec(`
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    create table auth.users(id uuid primary key,email text,encrypted_password text default '');
    -- Auth schema fixtures for the connector's live session/factor checks.
    -- These are test tables, never a parallel production MFA implementation.
    create table auth.mfa_factors(id uuid primary key,user_id uuid not null references auth.users(id),status text not null,factor_type text not null);
    create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),aal text not null default 'aal1',factor_id uuid,not_after timestamptz);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated,service_role;
    grant all on storage.objects to authenticated;
  `);
  const base = await readFile(path.resolve('supabase/schema.sql'),'utf8');
  await db.exec(base);
  return db;
}
