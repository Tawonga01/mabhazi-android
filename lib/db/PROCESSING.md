# First running normalisation stage

Migration0023 adds private `v2_normalised_leads`, `v2_worker_status` and fenced worker functions. Original migration hashes remain unchanged. This stage prepares the reported operator name/clock time for later association; it does not establish a real company, recurring timetable, confidence, fare, publication or prompt eligibility. Original observations remain immutable.

Queue claims use SKIP LOCKED, random120s token leases, monotonic attempt counts and an eight-attempt initial budget. Heartbeats can extend only a live current-generation lease. Every normalisation effect verifies token/expiry/generation under the shared structural guard; expiry after writing raises a serialization failure that rolls back projection/effect/next-stage intent together. Recovery of a crashed committed claim changes the token. A whole SQL tick rolls back on process/statement failure; supported per-job errors are retried with bounded exponential delay plus jitter and retained as failed after exhaustion.

Only `normalise`/`intake/1` is consumed. Unsupported policies and all later stages stay pending. Next-stage `associate`/`association/1` is deduplicated by subject/generation/policy; no matching handler is claimed. Current-generation projection clears synchronously after input/lifecycle/observation-state changes and cascades on physical source/account erasure. Missing/withdrawn original required facts cannot be reconstructed from the intake snapshot. Search keys are candidate hints and never prove same operator identity.

The backend role has read-only queue/effect/projection/status tables and only narrow worker functions. Hosted anon/authenticated roles have neither table nor function access. Explicit failed-job retry remains owner-only, keeps lifetime attempts and refuses stale/retired work. Existing contribution erasure trigger executes with its owner permissions so queue-DML revocation does not break account deletion.

## Running and operating

For an existing configured isolated preview environment:

```
pnpm --dir artifacts/api-server run worker:normalise
pnpm --dir artifacts/api-server run worker:health
```

The CLI fails closed unless the preview target/auth/restricted database role match; it does not run at API startup or send app emails. One drain has20-job maximum,20s statement timeout and5s lock timeout. No credential is printed. A CLI tick is not independent unattended execution; deploy and prove the documented scheduler separately.

Chosen first SQL-only stage can use Supabase pg_cron without calling/waking Render or copying a new credential. Enable/schedule only after verified migrations and specifically scoped live permission. Use one preview-named job every minute with20s statement/5s lock timeout; monitor cron run history plus `SELECT public.v2_worker_health()`. Database pause/outage still requires recovery; this does not promise a one-minute SLA. Do not add the cron schema/functions to the public Data API. No paid Render worker or scheduler subscription is implied.

Health includes supported pending/leased/failed/expired counts, oldest due timestamp, last completed tick, up to20 failed job IDs with safe codes/attempts, and other pending-stage count. Warn when oldest due work exceeds10minutes or a tick is missing for5minutes while work is pending. These pilot warnings need operator observation; no automatic alert delivery is implemented.

For a failed job, inspect its safe code, fix the cause and use owner-only `SELECT public.v2_worker_retry_normalise('<job-id>'::uuid)`. It grants another eight attempts without losing historical attempt count. Stale failures remain visible and cannot be blindly retried into old effects. Never edit live lease tokens/expiry/generation directly as a recovery method.

Pause by disabling only the named cron job. Preserve evidence/receipts/jobs; no destructive down migration. Re-enable and inspect new cron success/queue state. Full multi-stage worker, assessment/expiry/task/review/publication consumers and operational acceptance remain work across WP04–WP10.
# Lead association stage (0024)

`v2_worker_drain_associate(1..20)` consumes only `associate/association/1` for current normalised minimum leads. Each claim lasts120 seconds; the source generation, current token and wall clock fence every effect. A page scans at most50 targets in the same directed corridor. Private cursor/catalog records allow further pages and reset the scan when its corridor changes. Successful pages preserve the failure budget without discarding lifetime attempts. New neighbours and structural/normalised-input changes coalesce durable wakeups, including after a completed scan.

`same_corridor` candidates explain grouping without identity. `same_service` run candidates require known equal operators and exact clocks; unknown dates/stops/time basis stay explicit review reasons. Equal names, different known operators, opposite directions and different departure clocks never resolve identity. The worker writes no accepted link, target reassignment, selected field or timetable. Sealed candidate evidence includes the original required observations; erasure clears both digest copies and scan projections. A rejected unchanged evidence basis is not reopened by derived-generation retries. Existing decision primitives retain rejection/reversal history.

The page, final effect and next `assess/evidence/1` intent commit transactionally; an ambiguous COMMIT is never acknowledged as success. CLI `worker.ts associate [limit]` remains preview-only. Health now covers both supported stages and counts unsupported policies as remaining work. Owner-only retry preserves lifetime attempts. Hosted clients cannot read private scans or invoke workers; the API has only read/fenced facades, with no candidate/queue/cursor DML or review-authority grant.

Preview application/scheduler activation requires separate scoped approval and live proof after exact-commit CI.0024 does not alter the existing normaliser schedule by itself. Full pattern/variant/contained-segment/import/correction/actual-journey producers, reviewed identity/retarget UI and multi-stage operations/recovery remain WP05–WP12 work. Existing Android contract/signing stay compatible; no new APK is required for this SQL/backend capability.

# Pattern association stage (0025)

The existing fenced `associate` facade dispatches only lead association/1 and pattern-association/1, sharing the20-claim bounded tick and existing scheduler. A pattern page processes at most10 target patterns and50 proposals; lazy ordered-subsequence windows use a target/key cursor with one lookahead. Repeated visits, gaps and permission uncertainty remain explicit candidates. Route/corridor epochs reset pages after structural changes. Successful pages preserve failure budget/lifetime counts. No total-candidate cap, accepted identity, field selection, fare/calendar inheritance or native API change is introduced.

Known equal complete stop visits with fully known equal permissions can propose same_pattern only within one operator/route/direction. Known stop-order/permission differences can propose variants. Incomplete lists cannot prove those relationships. Contained segments use actual longer-pattern sequence bounds, preserving alternate endpoints and intermediate-stop/boarding uncertainty. Retired context and stale/erased reviewed origins are excluded. Proposal digests and symmetric pair orientation deduplicate reciprocal scans; rejection persists across unchanged derived retries.

Private support links retain structural-origin observations. Withdrawal/deletion invalidates dependent decisions and redacts copied fingerprints; originals and unrelated reports survive. Identity reviews may use only evidence declared by their exact bound candidate across its endpoints/origins. That precise review increment preserves its candidate; other input changes invalidate it. Applying a generated pattern link rechecks its current structural rule/bounds and requires the declared origin evidence to have been reviewed. Existing role/actor/revision requirements remain; no reviewers are granted or public/private-evidence endpoint enabled.

Migration0025 checks prior worker/review body hashes, SECURITY DEFINER and pinned search_path before adapting existing fences. Original0000–0024 remain immutable. Private helpers deny hosted clients/backend direct execution; the existing API facades remain fenced. A one-time activation queues pre-existing eligible patterns after live approval; new/sealed/changed patterns enqueue automatically. Exact CI, preview activation, independent-run proof and full remaining import/correction/actual-journey/reviewer/UI/evidence/publication/device/recovery work are tracked separately.

# Reviewed identity lookup integration

Migration0026 adds [reviewed aliases and namespaced mappings](IDENTITY-LOOKUP.md). The lead consumer preserves reported-name identity and adds reviewed/ambiguous alias hints to corridor candidates; catalog wakeups and erasure clear stale candidate projections. The current public minimum contract and existing worker facade/policy stay unchanged. Source-ID readers are ready for later import integration; no actual feed or public review workflow is completed by this migration.

# Corrected intake and actual journeys (0027)

[Journey processing](JOURNEY-PROCESSING.md) extends current-leaf correction normalisation and reference-only actual input. The existing associate facade also dispatches actual-association/1, with50-target pages under explicit selected service context, catalog wakeups, review/context guards and separate health. Missing intention/lead-only context remains unresolved; no actual clock is converted into a scheduled run. Five new private tables remain backend SELECT only, new helpers owner-only. Existing CLI/Cron bounds and public API/phone contract stay unchanged. Exact-source CI and scoped preview application/proof are recorded separately; writing this capability is not live acceptance or full WP05 completion.


# Evidence assessment execution (0031)

The bounded assess/evidence/1 consumer executes the existing0010 evaluator and0011 field interpretation without changing policy thresholds, canonical identities or publication gates. It processes at most10 exact field/scope pairs per lease effect. Valid current assessment/field pointers provide resumable progress; successful pages preserve failure budget, while random120s tokens and current generations fence every effect. Creating an assessment and reading its new row use separate SQL commands so interpretation sees the committed command's result. An unchanged duplicate job reuses assessment/decision history and does not advance subject revision.

The existing worker status constraint now admits assessment-worker/1. No persistent tables are added. Backend receives only claim/heartbeat/fail/finish/bounded-drain entry points; evaluator, scope helpers and failed-job retry remain owner-only. Current-time reads continue to reject invalidated or expired evidence. Quoted, advertised and historical paid fares remain distinct. A completed assessment queues refresh_tasks/prompts/1, which is still an unimplemented consumer; health keeps it in otherPendingStages.

CLI: worker.ts assess [1..20], or pnpm --dir artifacts/api-server run worker:assess. Independent Preview cron preparation is lib/db/scripts/preview-schedule-assess.sql; apply only after exact guarded0031 verification and separately scoped action-time permission. It preserves the existing two minute jobs and creates one assessment minute job, with20s statement/5s lock limits and no new credential or paid service. No scheduler is enabled by the migration alone. Owner retry is SELECT public.v2_worker_retry_assess(jobUUID); it preserves lifetime attempts and rejects stale/retired/unsupported-policy work. Pause only mabhazi-preview-assess-v1, retain observations/receipts/history/jobs, inspect failure reasons and re-enable after repair.

Canonical field publication, safe public fare DTO/display, relevant-user task execution, reviewer tools and full recovery/pilot/native acceptance remain separate work. Neither checked-in code nor CI proves a running hosted worker. Exact commit, guards, live application and independent-run proof belong in the project checkpoint.

0031 also repairs same-account/source fare deduplication so different currencies remain distinct propositions, as required by the existing evidence contract. It changes no threshold. Affected pre-existing cached fare scopes advance generations and queue reassessment; originals and historical decisions survive. Exact populated upgrade exercises a previously collapsed two-currency assessment and refuses its stale projection after migration.

A private subject-generation trigger wakes current-policy evidence processing after withdrawal, source/target/review changes or erasure on already-assessed subjects. It does not consume legacy operation-policy jobs or unsupported future evidence policies; those remain visible as other pending work. Withdrawal/source-removal tests exercise automatic wakeup without a helper enqueue. No new reports or support are invented.
