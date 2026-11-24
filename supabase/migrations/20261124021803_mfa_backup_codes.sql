-- Two-step backup ways in: backup codes (kept encrypted so Settings can always show them)
-- and a log for rate limiting recovery attempts. Only the mfa-recovery function touches these.
create table if not exists public.mfa_backup_codes (
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  code_enc bytea not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, code_hash)
);
create table if not exists public.mfa_recovery_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists mfa_recovery_log_user_at on public.mfa_recovery_log (user_id, at desc);
alter table public.mfa_backup_codes enable row level security;
alter table public.mfa_recovery_log enable row level security;
revoke all on public.mfa_backup_codes, public.mfa_recovery_log from anon, authenticated;

-- Replace your codes with a new set
create or replace function public.mfa_codes_store(p_user uuid, p_codes text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  delete from public.mfa_backup_codes where user_id = p_user;
  foreach c in array p_codes loop
    insert into public.mfa_backup_codes (user_id, code_hash, code_enc)
    values (p_user, encode(extensions.digest(upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex'), public.encrypt_text(c));
  end loop;
end $$;

-- Your codes, for Settings
create or replace function public.mfa_codes_list(p_user uuid)
returns table (code text, used boolean) language sql security definer set search_path = public, extensions as $$
  select public.decrypt_text(code_enc), used_at is not null from public.mfa_backup_codes where user_id = p_user order by created_at, code_hash;
$$;

-- Use one code (true if it was valid and unused)
create or replace function public.mfa_code_use(p_user uuid, p_code text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  update public.mfa_backup_codes set used_at = now()
  where user_id = p_user and used_at is null
    and code_hash = encode(extensions.digest(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.mfa_codes_store(uuid, text[]), public.mfa_codes_list(uuid), public.mfa_code_use(uuid, text) from public, anon, authenticated;
grant execute on function public.mfa_codes_store(uuid, text[]), public.mfa_codes_list(uuid), public.mfa_code_use(uuid, text) to service_role;
