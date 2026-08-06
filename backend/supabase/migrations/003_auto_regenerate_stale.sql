-- Opt-in: rebuild stale content the moment an incremental analysis flags it.
--
-- Today a re-analysis only marks sections/tutorials stale and waits for
-- someone to click Regenerate. That is the right default — regeneration is
-- LLM spend, and spending it without a click is exactly the surprise a budget
-- cap exists to prevent. But a team that re-analyzes on every push has to go
-- click through packages to get current docs back, and "the badge told me it
-- was out of date and then did nothing" is the most common complaint about the
-- flow.
--
-- So: a per-project boolean, DEFAULT FALSE. Off = today's behaviour exactly
-- (badges only). On = the analysis worker enqueues one only-stale generation
-- per affected package right after the diff. Existing rows take the default,
-- which is the current behaviour, so no project changes what it does because
-- this column appeared.
--
-- Additive and backwards compatible on purpose: M5 freezes the schema so the
-- reviewer can test M4 all milestone (doc/DEVOPS.md), and a nullable-free
-- boolean with a default is the only shape that adds a setting without
-- touching a single existing read path.
alter table public.project_settings
  add column if not exists auto_regenerate_stale boolean not null default false;

comment on column public.project_settings.auto_regenerate_stale is
  'When true, an incremental analysis that flags artifacts stale immediately enqueues one only-stale package generation per affected package (checkpoint.onlyStale). False (default) = stale content is flagged and waits for a manual Regenerate. Costs LLM calls without a click, which is why it is opt-in.';
