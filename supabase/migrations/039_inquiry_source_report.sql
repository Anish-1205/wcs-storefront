-- Lead-source report (T4.6): enquiries per ISO week (India time) × source ×
-- status, for the admin report page. An aggregate over index-backed columns
-- (inquiries_created_idx, inquiries_source_idx from 037); no rows leave, only
-- counts. Service role only.

create or replace function public.inquiry_source_report(p_weeks integer default 12)
returns table(week date, source text, status text, enquiries bigint)
language sql stable security invoker set search_path = public as $$
  select date_trunc('week', (created_at at time zone 'Asia/Kolkata'))::date as week,
         coalesce(source, 'unknown') as source,
         status,
         count(*) as enquiries
    from inquiries
   where created_at >= now() - make_interval(weeks => least(greatest(p_weeks, 1), 104))
   group by 1, 2, 3
   order by 1 desc, 2, 3
$$;

revoke all on function public.inquiry_source_report(integer) from public, anon, authenticated;
grant execute on function public.inquiry_source_report(integer) to service_role;
