create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  slot_time time not null,
  person1 text not null,
  person2 text not null,
  phone1 text not null,
  phone2 text not null,
  created_at timestamptz not null default now(),
  unique (event_date, slot_time)
);

alter table public.bookings enable row level security;

drop policy if exists "Allow insert for everyone" on public.bookings;
create policy "Allow insert for everyone"
on public.bookings
for insert
with check (true);

drop policy if exists "Allow read for everyone" on public.bookings;
create policy "Allow read for everyone"
on public.bookings
for select
using (true);
