-- Store location from Plaid's Transactions data (free with the subscription) so a
-- transaction can show its street address and a small map.
alter table public.synced_transactions
  add column if not exists enriched_location_address text,
  add column if not exists enriched_location_postal_code text,
  add column if not exists enriched_location_lat double precision,
  add column if not exists enriched_location_lon double precision,
  add column if not exists enriched_location_store text;
