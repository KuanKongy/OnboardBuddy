-- 'declined' is its own status: an invitee saying no is not an admin revoking.
--
-- The status CHECK shipped with four values, and Decline had nowhere to land,
-- so it wrote 'revoked' (#72). That is the wrong word in three places at once:
-- the invitee's own history says an admin retired the invitation, the team page
-- cannot tell "they said no" from "we changed our mind", and Re-invite has no
-- signal that the last attempt was actively refused. Adding the fifth value is
-- the whole fix — the decline route then writes 'declined' and both readings
-- become true.
--
-- Relaxing a CHECK is additive: it accepts everything it accepted before, so no
-- existing row and no existing write can start failing because this ran. That
-- matters here because M5 freezes the schema so the reviewer can test M4 all
-- milestone (doc/DEVOPS.md). Checked against the Milestone4 tree: both M4 list
-- queries filter `status = 'pending'`, so a declined row is invisible to them;
-- the two by-id reads (the invitation detail GET and accept) carry no status
-- filter, and accept already answers a non-pending row with
-- `Invitation has already been <status>` — which now reads "declined" and is
-- the sentence you wanted anyway.
--
-- Old declines stay 'revoked'. They are indistinguishable from real revocations
-- in the data, so backfilling would have to guess, and a wrong guess is worse
-- than an honest one: history reads slightly harsher than it was for
-- invitations declined before this migration, and nothing after it.
--
-- idx_project_invitations_pending_unique_email is untouched: it is partial on
-- `status = 'pending'`, so declined rows never occupy the one-live-invitation
-- slot and Re-invite/Resend can always write a fresh row.
--
-- The name below is Postgres's default for a column-level CHECK on
-- project_invitations.status. Confirm it before running:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.project_invitations'::regclass and contype = 'c';
-- If the live constraint carries a different name this migration still reports
-- success — the DROP no-ops, the ADD writes a second, wider CHECK, and the old
-- narrow one keeps 500ing every decline. Rename the DROP to whatever that query
-- returns.
alter table public.project_invitations
  drop constraint if exists project_invitations_status_check;

alter table public.project_invitations
  add constraint project_invitations_status_check
  check (status in ('pending', 'accepted', 'revoked', 'expired', 'declined'));

-- DOWN. The UPDATE is not optional: the narrow CHECK is validated against the
-- existing table on ADD and fails on the first 'declined' row. It also destroys
-- the distinction this migration exists for, so going down loses data.
--
--   alter table public.project_invitations
--     drop constraint if exists project_invitations_status_check;
--
--   update public.project_invitations set status = 'revoked' where status = 'declined';
--
--   alter table public.project_invitations
--     add constraint project_invitations_status_check
--     check (status in ('pending', 'accepted', 'revoked', 'expired'));
