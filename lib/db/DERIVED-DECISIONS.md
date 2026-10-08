# Association and field decision storage

Migration 0005 extends the registry with real association and field subtypes.
Eight tables store association candidates/evidence/decisions/active links, field
decisions/evidence/current pointers and decision-backed transport snapshots.
These tables are internal, readable only by the backend and owner. Processing
writes and apply helpers are owner-only until WP04-WP07 supply authenticated
reviewer or leased-worker transactions. No new public API is enabled.

Candidate relations preserve different meanings: same corridor, same pattern,
same service, duplicate, variant, contained segment and correction. Typed endpoint
references reject unsupported combinations; segment bounds are required where
appropriate. Candidate input is immutable and evidence seals at the first
decision. Candidates do not merge identities or retarget original observations.
Names, times or account counts do not authorize an automatic identity match.

The internal apply primitive permits automatic same-corridor grouping only with
equal known directed corridor IDs. Identity acceptance needs a current identity
review explicitly bound to that candidate and its declared evidence; the binding
cannot change after a decision. Field-specific reviews cannot
approve identity. It checks case lineage, both subject revisions and candidate
revision under the structural guard. A candidate based on an older revision can
only account for the exact review revision increment; unrelated changes require
new evaluation. Reversing records history and removes only that candidate's link.
This does not implement candidate generation, complete transport matching rules,
observation-target reassignment or canonical identity materialisation.

Field decisions currently cover the seven initial typed observation fields.
Selected values must have matching active supporting observations, original
subject, field, scope hash AND scope content. Revision lineage is contiguous and
cannot cross a field/subject/scope boundary. Each field keeps its own support,
dispute, freshness and publication state. Until source grouping and calibrated
policy processing are implemented, a constraint limits support to unknown/reported,
freshness to unknown and publication to provisional/withheld. A bare storage row
cannot claim corroboration or a publishable timetable. Unknown never creates a
zero price, midnight or recurring calendar.

Applying a field pointer checks expected subject revision and input generation;
derived output advances the API revision without inventing a new input generation.
Reapplying the current decision has no repeated effect. New input generations
clear stale current pointers. Association effects advance both subjects and
queue assessment. Queue records do not imply a running worker; task/publication
effects and lease validation remain WP04-WP10 requirements.

Transport history snapshots come from an allowlisted subtype table, omit intake
attribution/raw import strings and are checked against that exact subject/revision.
Origins reference a real matching decision or the lead's actual initial
contribution. Current apply paths record snapshots; initial contribution capture
and all future canonical projection writers must be wired by their API/worker
transactions. Existing draft transport writers are not claimed to be fully
audited by this migration. Pattern-stop version provenance and reviewed precision/
legacy/actual-journey links still require explicit integration.

Withdrawal/hiding or reversal invalidates dependent decisions and removes current
values/links synchronously. Erasing evidence also clears copied selected values,
scope and input digests, redacts affected transport snapshots, removes candidate
evidence and leaves safe field-evidence tombstones. Dependent revision chains are
traversed, including decisions backed by an erased review. Contribution deletion
clears snapshots of its original subject; unrelated subjects survive. No actor
or private rationale is copied from review decisions into these new tables.
Further observation/source/target/prompt projections must extend this deletion
graph before becoming writable or public.

SQL owns constraints, deferred checks, access and erasure; Drizzle maps queries.
Run migrations and the disposable PostgreSQL `test:intake` suite, typechecks and
existing backend/Android validation. No live schema application, backfill or
recovery rehearsal has occurred. The complete WP02 and R01-R14 scope remains.
