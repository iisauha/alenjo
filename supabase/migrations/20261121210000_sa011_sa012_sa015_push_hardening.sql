-- Applied to project itkufrockebnlzcroigc on 2026-11-21 (security re-audit).
-- SA-011/SA-012: devices are only saved through register_push_device(), which
-- accepts real push services only and won't move a device to another account
-- without that device's own keys. SA-015: server-only tables and DB-side HTTP.
drop policy if exists "own devices: add" on public.push_devices;
drop policy if exists "own devices: update" on public.push_devices;
revoke all on public.push_devices from anon;
revoke insert, update, truncate, references, trigger on public.push_devices from authenticated;
grant select, delete on public.push_devices to authenticated;
-- register_push_device(): see live definition (host allowlist + key check)
revoke all on public.notified_transactions from anon, authenticated;
revoke all on public.push_queue from anon, authenticated;
revoke all on sequence public.push_queue_id_seq from anon, authenticated;
-- net.http_* execute is granted to PUBLIC by supabase_admin (platform-owned); not exposed via the API.
