create extension if not exists pgcrypto;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  slot_time time not null,
  email text,
  person1 text not null,
  person2 text not null,
  phone1 text not null,
  phone2 text not null,
  status text not null default 'active',
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.bookings add column if not exists email text;
alter table public.bookings add column if not exists status text not null default 'active';
alter table public.bookings add column if not exists canceled_at timestamptz;
alter table public.bookings drop column if exists reservation_code;

alter table public.bookings drop constraint if exists bookings_event_date_slot_time_key;
alter table public.bookings drop constraint if exists bookings_reservation_code_key;

create unique index if not exists bookings_active_slot_unique
on public.bookings (event_date, slot_time)
where status = 'active';

create unique index if not exists bookings_active_phone_unique
on public.bookings (phone1)
where status = 'active';

drop index if exists bookings_reservation_code_unique;

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

drop policy if exists "Allow delete own bookings" on public.bookings;
drop policy if exists "Allow update for everyone" on public.bookings;
create policy "Allow update for everyone"
on public.bookings
for update
using (true)
with check (true);
