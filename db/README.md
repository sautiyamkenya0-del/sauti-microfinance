# Database

This folder is the source of truth for the Sauti Microfinance database.

## Layout

- `full.sql` — the COMPLETE current schema. A fresh environment can be
  rebuilt by running this file once. Always kept up to date.
- `changes/NNNN_description.sql` — one file per incremental change,
  numbered in order. Each file is what was actually applied via the
  project migration flow.

## Workflow for a new change

1. Create the next change file: `db/changes/NNNN_what_changed.sql`
   containing ONLY the delta (e.g. `alter table ... add column ...`).
2. Apply it through Supabase so it runs against the target project.
3. Fold the same change into `db/full.sql` so the canonical schema stays
   in sync. Bump enums, add columns in-place, etc.
4. Commit both files together.

## Security

All tables enable RLS with no public policies. Server-side code reaches
the DB through TanStack server functions using `supabaseAdmin`
(service-role), which bypasses RLS. Direct browser access is denied by
default. Add explicit policies in `full.sql` only when client access is
required.
