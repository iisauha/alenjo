-- Small copies of the pictures the app shows (bank and store logos, card art, your photo),
-- saved as data URLs so the app can draw them from its own saved data instead of downloading
-- them every time it opens. data = 'none' means there's no logo (show the letter).
create table if not exists public.image_cache (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  data text not null check (length(data) <= 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.image_cache enable row level security;
create policy "own pictures: read" on public.image_cache for select using (user_id = auth.uid());
create policy "own pictures: add" on public.image_cache for insert with check (user_id = auth.uid());
create policy "own pictures: change" on public.image_cache for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pictures: remove" on public.image_cache for delete using (user_id = auth.uid());
alter table public.image_cache drop constraint if exists image_cache_data_check;
alter table public.image_cache add constraint image_cache_data_check check (length(data) <= 400000);
