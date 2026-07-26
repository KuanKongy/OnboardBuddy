-- Honest coverage: record how many files the parser ACTUALLY read.
--
-- `file_count` is `fileRecords.length` — every file in scope, including
-- images, markdown and lockfiles. It was being surfaced to users as
-- "Analyzed N files" and, worse, injected into section prompts as
-- "Stats: N files", so the model wrote its narrative against a number that
-- overstated real coverage several-fold (one audited project by 9x).
--
-- `language_inventory.supportedFileCount` is closer but still wrong: it counts
-- files a parser *could* read, not files a parser *did* read. The gap is real
-- — supported source files can be skipped or fail to parse.
--
-- Backfill leaves existing rows at NULL rather than guessing. NULL means
-- "this snapshot predates the column"; readers must show it as unknown, never
-- substitute `file_count` — that substitution is the bug being fixed.
alter table public.analysis_snapshots
  add column if not exists parsed_file_count integer;

comment on column public.analysis_snapshots.parsed_file_count is
  'Files the AST parser actually produced a FileAnalysis for (snapshot.fileAnalyses.length). NULL for snapshots taken before this column existed. Distinct from file_count (all files in scope) and language_inventory.supportedFileCount (files a parser could read).';
