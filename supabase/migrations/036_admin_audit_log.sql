-- Admin audit log (T3.1).
--
-- An append-only record of destructive and privileged admin actions: who
-- (the auth user id, never an e-mail), what, on which entity, and a small
-- allowlisted `meta` (field names and ids, never values a customer typed).
-- Written by src/lib/audit.ts with the service role, after an admin check.
--
-- Append-only: the service role may insert and read, not update or delete.
-- The only way rows leave is admin_audit_prune(), which keeps 12 months by
-- default.

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' and length(action) <= 64),
  entity text check (entity is null or length(entity) <= 64),
  entity_id text check (entity_id is null or length(entity_id) <= 128),
  request_id text check (request_id is null or length(request_id) <= 128),
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 4096)
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);
create index if not exists admin_audit_log_entity_idx on public.admin_audit_log (entity, entity_id, at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated, service_role;
grant select, insert on public.admin_audit_log to service_role;

-- Retention. security definer so the service role, which cannot delete rows
-- itself, can still prune old ones; the function only ever deletes by age,
-- and never anything younger than 30 days.
create or replace function public.admin_audit_prune(p_keep interval default interval '12 months') returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from admin_audit_log where at < now() - greatest(p_keep, interval '30 days');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.admin_audit_prune(interval) from public, anon, authenticated;
grant execute on function public.admin_audit_prune(interval) to service_role;
