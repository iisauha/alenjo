-- Separate switches for card/loan payments and moves between your own accounts
alter table public.notification_settings
  add column if not exists card_payments boolean not null default true,
  add column if not exists transfers boolean not null default true;
