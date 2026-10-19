-- AI usage ledger, daily caps and kill switch (T2.1).
--
-- Nothing limited Anthropic calls or spend. Every call now goes through
-- src/lib/ai/budget.ts, which reserves against a per-feature daily cap here
-- before the HTTP request, records the tokens the response reports, and stops
-- calling when the kill switch is on or a provider spend limit was hit.
--
-- Days are UTC. Admin-only: RLS on with no policies, service_role only.
-- Additive: two new tables and four functions; nothing existing changes.

create table if not exists public.ai_usage_daily (
  day date not null,
  feature text not null check (feature ~ '^[a-z][a-z_]{0,63}$'),
  requests integer not null default 0,
  rejected integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, feature)
);

-- Single row. kill_switch stops every call; paused_until is set when the
-- provider reports a spend limit, so nothing is retried until it resets.
create table if not exists public.ai_settings (
  id boolean primary key default true check (id),
  kill_switch boolean not null default false,
  paused_until timestamptz,
  pause_reason text,
  updated_at timestamptz not null default now()
);
insert into public.ai_settings default values on conflict (id) do nothing;

alter table public.ai_usage_daily enable row level security;
alter table public.ai_settings enable row level security;
revoke all on public.ai_usage_daily, public.ai_settings from public, anon, authenticated;
grant all on public.ai_usage_daily, public.ai_settings to service_role;

-- Atomic reserve. Returns 'ok' when the call may go ahead, otherwise why not:
-- 'kill_switch', 'paused' or 'cap'. A refusal is counted in `rejected`.
-- Concurrent callers can never take a feature past its cap: the increment is
-- one guarded UPDATE on the (day, feature) row.
create or replace function public.ai_try_reserve(p_feature text, p_cap integer) returns text
language plpgsql security invoker set search_path = public as $$
declare s ai_settings; d date := (now() at time zone 'utc')::date; reason text; reserved boolean;
begin
  select * into s from ai_settings where id;
  if s.kill_switch then reason := 'kill_switch';
  elsif s.paused_until is not null and s.paused_until > now() then reason := 'paused';
  end if;
  insert into ai_usage_daily(day, feature) values (d, p_feature) on conflict (day, feature) do nothing;
  if reason is null then
    update ai_usage_daily set requests = requests + 1
      where day = d and feature = p_feature and requests < greatest(p_cap, 0)
      returning true into reserved;
    if reserved then return 'ok'; end if;
    reason := 'cap';
  end if;
  update ai_usage_daily set rejected = rejected + 1 where day = d and feature = p_feature;
  return reason;
end $$;

create or replace function public.ai_record_usage(p_feature text, p_input bigint, p_output bigint) returns void
language sql security invoker set search_path = public as $$
  insert into ai_usage_daily(day, feature, input_tokens, output_tokens)
    values ((now() at time zone 'utc')::date, p_feature, greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0))
    on conflict (day, feature) do update
      set input_tokens = ai_usage_daily.input_tokens + excluded.input_tokens,
          output_tokens = ai_usage_daily.output_tokens + excluded.output_tokens
$$;

-- Called when the provider reports a spend limit. Only ever moves the pause
-- later, so two instances hitting the limit at once agree.
create or replace function public.ai_pause(p_until timestamptz, p_reason text) returns void
language sql security invoker set search_path = public as $$
  update ai_settings set paused_until = greatest(coalesce(paused_until, p_until), p_until),
    pause_reason = left(p_reason, 200), updated_at = now() where id
$$;

-- The admin switch (T2.9). Clearing it also clears a pause.
create or replace function public.ai_set_kill_switch(p_on boolean, p_clear_pause boolean default false) returns void
language sql security invoker set search_path = public as $$
  update ai_settings set kill_switch = p_on,
    paused_until = case when p_clear_pause then null else paused_until end,
    pause_reason = case when p_clear_pause then null else pause_reason end,
    updated_at = now() where id
$$;

revoke all on function public.ai_try_reserve(text, integer), public.ai_record_usage(text, bigint, bigint),
  public.ai_pause(timestamptz, text), public.ai_set_kill_switch(boolean, boolean) from public, anon, authenticated;
grant execute on function public.ai_try_reserve(text, integer), public.ai_record_usage(text, bigint, bigint),
  public.ai_pause(timestamptz, text), public.ai_set_kill_switch(boolean, boolean) to service_role;
