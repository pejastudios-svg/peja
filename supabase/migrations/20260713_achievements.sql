-- Safety-readiness badges (PEJA_HOME_V2_PLAN.md Batch D). Definitions
-- live in code (src/lib/achievements.ts); this table only records
-- unlocks. Awarded server-side at natural event points + a derivable
-- sync endpoint. NO engagement bait: badges mark readiness and helping.

create table if not exists public.user_achievements (
  user_id     uuid not null references public.users(id) on delete cascade,
  key         text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_achievements enable row level security;

-- Own badges readable; writes only via service role.
drop policy if exists "own achievements read" on public.user_achievements;
create policy "own achievements read"
  on public.user_achievements for select
  to authenticated
  using (user_id = auth.uid());

comment on table public.user_achievements is
  'Unlocked safety-readiness badges. Definitions in src/lib/achievements.ts.';
