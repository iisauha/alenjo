-- VAPID key rotation (2026-11-21). A temporary service-only setter let the push
-- function write a key pair it generated in-memory straight into Vault, so the
-- private key never left Supabase. The setter was dropped right after.
create or replace function public.set_vapid_keys(p_private_jwk text, p_public_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_priv uuid; v_pub uuid;
begin
  select id into v_priv from vault.secrets where name = 'vapid_private_jwk';
  select id into v_pub from vault.secrets where name = 'vapid_public_key';
  if v_priv is null or v_pub is null then raise exception 'vapid secrets missing'; end if;
  if p_public_key !~ '^[A-Za-z0-9_-]{87}$' or p_private_jwk not like '{%"d":%}' then raise exception 'bad key format'; end if;
  perform vault.update_secret(v_priv, p_private_jwk);
  perform vault.update_secret(v_pub, p_public_key);
end $$;
revoke all on function public.set_vapid_keys(text, text) from public, anon, authenticated;
grant execute on function public.set_vapid_keys(text, text) to service_role;
-- ...rotation ran here...
drop function if exists public.set_vapid_keys(text, text);
