# Observation state history

Migration 0007 makes each observation's current state a projection of an
append-only event stream. An event has the previous event, from/to status,
revision, actor, reason and optional private withdrawal note. Moderation events
reference the actual review decision and do not copy its private explanation.
The latest-event composite FK binds the state to the same observation, revision
and status; guards also check its reason and predecessor. Direct state edits or
removing live history reject. The backend has SELECT-only table access.

Normal transitions:

- Insertion: submit event and active state, revision 1. No observed date inferred.
- Correction: the replacement's immutable supersedes ID must identify the same
  author's active observation on the same original subject/field. One supersede
  event points to the new observation. Competing corrections cannot fork it.
  Hidden/withdrawn/superseded predecessors reject; correction cannot bypass a hide.
- Withdrawal: active or hidden becomes withdrawn. The backend uses
  `v2_withdraw_observation(actor, observation, expectedRevision, requestId, note)`.
  The author must match, expected revision is required, and an identical retry
  returns the existing event. Changed retry content rejects. This is a backend
  primitive: the future HTTP layer must supply the authenticated actor itself.
- Moderation: an authorized current review with exact observation evidence can
  hide active or restore hidden reports. It runs inside `v2_record_review` when
  its case pointer advances, atomically with review/evidence. Empty target lists
  and incompatible statuses reject the entire review transaction.
- Reversal: a moderation reversal restores the previous status only if that
  exact reviewed event is still the observation's latest event. Later withdrawal,
  supersession or another case's action wins. Reversal cannot resurrect a report
  its author retired. Each applied reversal gets its own event.

State changes synchronously invalidate derived values/links using the existing
dependency graph. They also advance the original subject revision/generation and
queue assessment, even where no selected value exists yet. Restore queues fresh
assessment; it never reactivates a previously invalidated selection. A compound
review/invalidation can advance a subject more than once; callers must use the
returned/current revision rather than infer `old + 1`. Queueing is not a running
worker. Resolved-target invalidation will be extended when those targets exist.

Account advisory locks precede the shared guard in withdrawal/review functions;
correction insertions serialize through the same guard. Two-connection tests cover
READ COMMITTED and REPEATABLE READ withdrawals/corrections. The future submission
transaction must acquire its account lock before creating contributions and
inserting observations; this storage trigger is not complete request orchestration.
Initial submit events do not themselves advance subject generation or create the
submission job: that transaction remains an API/worker integration responsibility.

Observation/contribution deletion cascades owned event streams and private notes.
Account deletion removes owned observations/streams before account FK cascades,
so actor anonymisation cannot race the deletion of that event's own parent.
Deleting a reviewer nulls actor IDs and removes private text throughout affected
streams, while the justified moderation status remains. Deleting a replacement
nulls its history link with an explicit erased flag; superseded evidence does not
become active again. Existing evidence deletion also clears review rationale and
copied decisions. There is no public raw event/rationale endpoint. PRIVILEGES and
RLS explicitly revoke client and inherited hosted grants; only the constrained
withdraw function is newly executable by the backend. Other helpers are internal.

Existing states migrate to one explicit, unattributed baseline event preserving
their status, revision, reason and timestamp. Missing state requires inventory;
old correction chains are not retrospectively executed or assigned invented
actors. Baseline events record migration time separately from state update time.
The upgrade drains deferred checks before its final NOT NULL DDL. CI verifies
a populated hidden/revision-4 fixture, plus fresh/repeated migrations.

Still required: resolved targets, sources/groups, affiliation/tasks, complete
canonical/history integration, public APIs, worker/lease handling, contextual
forms, backfill/recovery and real-device acceptance. Existing four-field minimum,
publication gates, no-email preference, signing and navigation are preserved.
No live migration or new phone build is implied by these storage functions.
