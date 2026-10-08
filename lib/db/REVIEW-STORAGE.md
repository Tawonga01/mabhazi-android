# Review storage boundary

Migration 0004 adds six tables: a typed decision registry, reviewer role grants,
role events, review cases, immutable decisions and observation evidence links.
The registry currently admits review decisions only. Field and association
decision subtypes must exist before their kinds or references are admitted.

The server role can SELECT these tables; mutations use the pinned-search-path
SECURITY DEFINER functions `v2_change_review_role`, `v2_open_review_case` and
`v2_record_review`. PUBLIC and mobile roles have neither table access nor execute
permission, including inherited hosted grants. These functions trust the API to
bind the actor argument to the authenticated account. They are not per-user SQL
authentication and must never be exposed as anonymous/mobile RPCs. No new HTTP
endpoint is provided by this migration.

An explicit database-owner operation must bootstrap the first administrator
using a verified Mabhazi account ID. No real grant has been made by this PR.
Thereafter, only an active administrator can grant/revoke another account's
reviewer or administrator role. Self changes are rejected. Repeated active grants
and revocations do not duplicate audit events. Revoked grants stay history;
re-granting creates a new record. Deletion removes account identifiers.

Manual queue creation requires an active reviewer/administrator and a real typed
subject. Correction/conflict cases require a field and scope. Automated/report
case creation and association-candidate targets remain later work.

Recording a decision checks both the expected case and subject revisions,
authority, action/target shape, current reversal target and relevant evidence.
Affirmative actions need evidence; hidden evidence is admissible only to restore
it. Unrelated subjects, mismatched field/scope, duplicate/missing/withdrawn evidence
are rejected. Evidence currently targets the original subject; cross-subject
evidence must wait for the constrained observation-target/association model.

The transaction appends registry/decision/evidence, advances case and subject
revisions/input generation and adds an assessment job. A reversal references
the current non-reversed decision and reopens the case without deleting history.
It does not itself write canonical facts, hide observations, choose confidence,
or run the worker. Those effects must be connected atomically/invalidate affected
projections in WP04-WP07 before exposing review endpoints. Affiliation decisions
are deliberately unavailable until the claimed account/operator relationship and
dedicated proof model exist; a report naming a company is not affiliation proof.

Privacy is part of the transaction. Observation deletion removes its evidence
links, redacts private notes throughout every affected case (including subsequent
reversal notes), invalidates those decisions, reopens cases and enqueues erasure
recomputation. Reviewer deletion removes actor identifiers and private notes
throughout cases the account authored. Unrelated cases remain unchanged. Safe
reason/decision tombstones survive. HTTP reason codes must come from a controlled
catalog, not personal text. Private rationale may reference only its declared
case/evidence; later derived tables must extend erasure rather than copying it
into an untracked payload. No global deleted-person token is kept.

Lock order is account advisory lock(s, sorted for role changes), structural guard,
case/subject rows. The guard serializes authority checks, reviews and evidence
deletion. At repeatable read a conflicting guard write aborts with SQLSTATE 40001.
The API must surface stale expected revisions as a refresh-required conflict,
not silently replay the old judgment with new revisions. No worker is yet running.

SQL is authoritative; Drizzle provides internal query mappings. Run the full
`test:intake` disposable PostgreSQL suite, migration runner and typechecks. Never
apply via schema push or change previously checksummed migration files. Live
deployment still requires schema inventory and recovery rehearsal. This is a
tested foundation within partial WP02, not a complete review feature or phone
release.
