# Contribution storage: intake foundation

Migration `0002_contribution_intake.sql` is an additive first part of WP02. It has no API/mobile consumer or publication switch. Existing journey data, signing configuration and supported response shapes remain unchanged. Do not deploy it as a completed contribution feature.

The new tables store leads with departure city, clock departure, destination city and operator, plus optional typed observations. There is no fare column/default on a lead and no inferred calendar. A reported clock is not an approved recurring service. Legacy intake is a separately reserved server path, never a way for public submissions to bypass the minimum.

## Implemented boundary

- Registry subtypes: lead and operator only, with deferred subtype integrity and stable IDs. Later migrations extend the kind constraint and integrity trigger together.
- Directed city corridors; lead/contribution lineage with a defined deletion transition.
- Private immutable contribution input; per-account retry keys and matching durable receipts. SQL uniqueness is the storage primitive; API conflict/replay semantics arrive in WP03.
- Typed operator, reported departure, named pickup/dropoff and scoped fare observations. Generated reference columns give JSON IDs real foreign keys. Unknown optional facts produce no observation; explicit zero fare is supported.
- Observed/effective date ranges, same-account/subject/field correction lineage, initial observation states, owned sources and private-source link ownership.
- PostgreSQL durable jobs, lease shape, nonnull deduplication keys and stage-effect identities. No running worker is delivered by these tables.
- Account erasure cascades through private evidence and receipts, anonymises initial lead attribution, cancels contribution-dependent jobs, advances affected subject generations and queues recomputation. Account deletion must retain the existing account advisory lock; contribution writers must take that same lock in WP03. Future association/decision projections must extend this erasure path before enabling them.
- RLS enabled; table privileges denied to PUBLIC, anon and authenticated. Only the backend role has DML policies. These are server-wide policies; per-account HTTP authorisation is still required. Never expose raw tables through client credentials or serialize full rows as public DTOs.

The SQL migration is authoritative for constraints, deferred references, triggers, generated columns, grants and RLS. Drizzle provides query column/type mappings, checked against PostgreSQL in CI. Do not use `drizzle-kit push` or generate a replacement migration from these query mappings: those operations cannot preserve the custom SQL invariants.

API validation must additionally validate supported ISO currencies/precision, service-local observation dates (SQL permits UTC date +1 for time zones), canonical scope/value hashes, safe payloads/receipt responses, Terms, identity revision and operator affiliation authority. Source labels do not grant affiliation. State-change audit, supersession events and resolved observation targets remain for the next storage migrations. This foundation is deliberately not wired to intake until those operations have complete transactional implementations.

## Validation

Backend CI runs all migrations on a fresh PostgreSQL 17 database, then repeats the runner. `pnpm --dir lib/db run test:intake` creates a separately named disposable database with the prior migration ledger, seeds a synthetic legacy journey, runs the real migration runner twice and checks unchanged legacy data. It checks required fields, typed payloads/references, retry isolation, correction history, privacy, erasure, rollback, lease/deduplication constraints and RLS grants, including removal of inherited client-role grants. Its DATABASE_URL role needs CREATEDB/CREATEROLE on an isolated test cluster. The test reuses an existing backend role because PostgreSQL roles span databases; it removes any temporary client roles it creates after dropping the fixture database. It does not mutate rows in the supplied database. Run only with isolated development/CI credentials.

`pnpm --dir lib/db run verify-schema` is read-only column verification, not a substitute for behavioural tests. No runtime dependency or lockfile change is required.

## Apply and recovery gate

Before any live apply, record the actual deployed source commit, migration ledger/checksums, PostgreSQL version and a non-sensitive inventory of existing data. Confirm an available backup/export and rehearse restoration in a separate database using the same major version. Do not assume a hosted recovery feature exists on the current plan. Live access and this restore rehearsal are not yet verified.

Apply the checked-in migrations with the database owner credential using the existing migration runner. It holds a transaction advisory lock, checks every recorded checksum and commits DDL plus ledger atomically. Concurrent application starts never run DDL. A failed apply rolls back; inspect the ledger before retrying rather than manually marking it applied. Never edit a migration already applied to any shared environment.

Before v2 writes are enabled, rollback the application to the previously verified commit and retain these unused additive tables. Do not drop tables as a routine rollback. Once v2 writes exist, disabling intake/processing and rolling forward with a new correcting migration is the default; deleting the tables would lose contributions. Database restore must be coordinated with writes and later migrations to avoid losing newer data. No live restore or destructive rollback is automated here.

## Still required within WP02

Resolved routes/patterns/stops/calendars/runs and all supported service modes; subject revision history; full registered observation types; association, source-group, field and review decisions; observation state events/targets; prompt/task storage; legacy links/import preserving original values; backfill and whole-schema restore/upgrade rehearsal. WP03–WP12 API, worker, review tools, forms, prompts, display, integrated tests and signed phone delivery remain in scope.
