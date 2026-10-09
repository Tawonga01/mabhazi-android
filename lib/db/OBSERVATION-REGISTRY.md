# Typed observation storage

Migration 0006 extends intake and provisional field decisions to the 18 registered
fields. Original subject IDs stay immutable. Field/kind checks reject a scheduled
claim on an actual journey and other incompatible assignments. This does not
retarget evidence or modify canonical transport rows.

SQL is authoritative. These are internal storage shapes; public API validators,
canonical hashing, authenticated submission and worker paths remain subsequent
work. All new fields reject unlisted keys, wrong JSON types and missing required
members. Optional dates/timezones stay absent or null; no submission-date default.

| Fields | Value | Scope / constraints |
|---|---|---|
| operator.reported | `{name}` or `{id}` | lead/actual_journey; name is not resolved identity |
| departure.reported | `{time:"HH:mm",basis}` | lead only; original four-field intake is unchanged |
| operator.identity | `{id:operatorUUID}` | route/lead/actual_journey; reported evidence cannot change canonical operator |
| service.mode | `{mode}` | lead/service_plan; fixed_time/frequency/when_full/on_demand/unknown |
| service.calendar | weekdays and/or date range, OR explicit dates; exceptions and timezone optional | lead/service_plan; dates and weekdays are sorted unique sets; exceptions sorted unique by date; incomplete coverage allowed |
| departure.scheduled / arrival.scheduled | `{seconds:0..172799}` | run/lead; temporal scope; day offset encoded by seconds beyond 86400 |
| departure.actual / arrival.actual | `{time:"HH:mm"}` | actual_journey; serviceDate + timezone OR UTC offset when known; incomplete context is retained, not made comparable |
| boarding.pickup / alighting.dropoff | `{stopId}` OR `{cityId,name}`, optional instructions | lead/pattern/actual_journey |
| pattern.stops | `{stops:[{place,pickup,dropoff}],stopsComplete:boolean}` | pattern/lead; place uses stopId OR cityId/name; order and repeated visits preserved; complete requires at least two entries |
| stop.location | `{cityId,name,precision,latitude?,longitude?}` | stop; paired valid coordinates; named_place/approximate only; no surveyed assertion |
| fare.paid / fare.quoted / fare.advertised | `{amount:string,currency}` | lead/pattern/run/actual_journey; directed city_pair OR stop_pair; existing passenger/ticket/date qualifiers preserved |
| service.operating_status | `{status,basis}` | lead/service_plan/run; serviceDate or bounded effective period required; report is not a canonical suspension |
| timetable.sign_presence | `{status:"seen" or "not_seen",place}` | stop/lead; date/timezone if known; absence does not delete schedules |

Unless stated otherwise scope is `{}`. Temporal scopes require
`schemaVersion:"1.0"`, with optional serviceDate, effectiveFrom/effectiveTo,
timezone and calendarId. Actual scopes permit only serviceDate, timezone or
utcOffset (`±HH:mm`, at most ±14:00); date/timezone may be unknown. Providing both
timezone and offset is rejected rather than silently interpreting a conflict.
No clock is converted to an instant here; DST ambiguity remains a later timing
gate. Operating and sign scopes allow only their applicable temporal members.
Calendar observations hold qualifiers in value, with empty scope. Recurring
weekdays and explicit dates cannot both be specified; exceptions can refine either.

Fare scopes additionally permit quotationDate/sourceDate. The currency snapshot
in [reference/iso4217-2026-10-09.json](reference/iso4217-2026-10-09.json) records
the official [SIX ISO 4217 List One](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml),
published 17 September 2026, retrieved 9 October, with its SHA256. 155 non-fund
codes with numeric minor units are supported. Precious metals, no-currency/test
codes, historical and fund codes are unsupported. Maximum amount precision is
the smaller of the currency minor unit and two decimals (the v1 contract).
Excess precision is rejected, never rounded. This snapshot changes only through
an explicit migration; new currencies do not silently alter existing claims.

`v2_observation_refs` materialises every operator, stop, city, calendar and timezone
reference, including array elements, into real foreign keys. Calendar+timezone
pairs have a composite FK, so subsequent calendar edits cannot break the pair.
A deferrable comparison requires the reference rows to equal the original JSON;
independent inserts/removals/updates cannot forge the projection. No copied notes
or contributor identity is stored in it. Observation deletion cascades references;
existing decision invalidation/erasure clears selected-value copies and snapshots
for every newly supported subject kind. The projection is read-only for the
backend and unavailable to PUBLIC/anon/authenticated, including inherited grants.

The upgrade validates existing observations and selected values before backfill.
It fails with `v2_observation_registry_upgrade_requires_inventory` on incompatible
data rather than altering user content. Inventory/recovery rehearsal remains a
live-deployment gate. The disposable CI upgrade preserves populated 0005 records
and verifies the generated references; fresh/repeated migrations are also tested.

Still outstanding: append-only state events, reversible resolved targets, source
grouping, canonical writer/history integration, affiliation/tasks, policy engine,
APIs/UI, backfill/recovery and phone acceptance. The existing policy constraint
still prohibits corroborated/current/selected-publication claims. This migration
does not enable a public v2 endpoint, worker, live schema change or app release.
