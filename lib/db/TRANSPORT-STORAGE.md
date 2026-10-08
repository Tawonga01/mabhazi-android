# Transport structure, migration 0003

This is a second additive storage step within WP02, not a public timetable feature. It preserves migration 0002 and existing journeys. It introduces routes, stops, patterns/versions, service plans, calendars/exceptions, runs/stop times, frequency/availability windows, actual-journey context, namespaced external IDs and unresolved legacy links. All new tables use RLS and revoke client/PUBLIC privileges, including inherited defaults. Timezone reference data and the internal concurrency guard have narrower backend grants.

## Identity and history

Operator names are not unique identities. Different operators may share a name, and a route may have multiple directional/stopping patterns and departure runs. Composite foreign keys enforce subtype and parent-pattern/mode relationships. A reported lead still creates no canonical operator, pattern or timetable automatically.

Build a pattern version while `sealed=false`, add its ordered stops, then seal it in the same transaction. Current-pattern and service-plan foreign keys require a sealed version. Once sealed, its stops, permissions, completeness and validity cannot change; create a new version instead. Old plans keep referencing their original version. Partial lists stay incomplete; repeated visits to the same stop have distinct sequences. A complete list requires two entries and must agree with known endpoint cities. Stop/corridor edits also revalidate dependent complete patterns.

Sealing makes structure immutable, not reviewed/verified. Decision-backed subject revisions, pattern-version reason lineage, affiliation evidence, observation targets and reviewer authority are required in subsequent WP02 work before canonical writer endpoints are enabled. `surveyed` stop precision and `reviewed` legacy links remain unavailable until their decision references exist. Do not create unchecked placeholder decision UUIDs.

## Time and calendars

Run times use integer seconds from the service date, bounded to less than 48 hours. Example: 23:30 to 01:15 next day is 84600 to 90900. Unknown intermediate times remain NULL. Known times cannot go backwards, escape the run bounds or reference stops outside the parent's exact pattern version. An origin arrival may precede the run's departure while the bus waits at its first stop.

Calendar timezone names are seeded from PostgreSQL's installed named-zone registry (plus UTC); owner migrations maintain this reference set when tzdata changes. A plan's explicitly supplied timezone must agree with its calendar. Missing plan timezone/calendar/dates/weekdays remains unknown. No default daily service exists. Weekday mask uses Monday bit 0 through Sunday bit 6; explicit-date calendars use exception rows. A date has one add/remove action, not both.

Frequency windows require frequency plans and a positive headway; availability windows require when-full/on-demand plans and either both bounds or neither. These modes cannot own fixed departure runs. Structural storage does not implement calendar eligibility, exception evaluation, DST ambiguity resolution, next-departure calculation or confidence/freshness publication gates; those remain WP06/WP10. Phone timezone is never stored as a guessed service timezone.

## Concurrent writes

Structural mutations update a single internal guard row before editing transport rows. This conservatively serializes writes while reads remain concurrent. The row update also produces a serialization failure for competing stale REPEATABLE READ snapshots, avoiding the stale-snapshot problem of an advisory lock alone. Deferred checks validate the final transaction. Unique/FK constraints enforce mode, version and external-ID integrity under concurrent parent/child edits.

Future reviewer/worker transactions must acquire this guard before subject locks, lock subjects in stable order, and retry deadlock/serialization failures using their idempotent operation key. This is a deliberate early-volume correctness choice; bulk imports should use short bounded transactions. Contention metrics/load tests must inform any later move to finer-grained locks. A queue table alone still does not establish an independently running worker.

## Validation and deployment boundary

The existing `test:intake` suite now tests both storage steps in a disposable PostgreSQL database. Its upgrade fixture starts with 0000–0002 and actual synthetic legacy/intake rows, applies the real runner through 0003 twice, verifies original values, then runs isolated rollback cases. Fresh application of all migrations remains a separate CI step. Drizzle column/type/primary-key/generated-column checks and client-grant tests include all new tables. The concurrency case uses two real database connections and an overlapping stop-parent edit, followed by a retry that must reject the resulting cycle.

Use checked-in SQL migrations; never schema push. Live migration/deployment remains gated on authenticated baseline/ledger inspection and backup/restore rehearsal. The migration performs no live-data import or legacy backfill. No mobile/native/signing configuration changes. Keep the draft PR unmerged while WP02 storage remains incomplete.

Remaining WP02 work: decision-backed subject revisions; all typed observation fields, targets and state events; association/source-group/field/review decisions; prompt/task storage; privacy erasure through derived projections; honest legacy backfill; complete recovery rehearsal. Retain all WP03–WP12 API, processing, forms, prompts, display and signed delivery requirements.
