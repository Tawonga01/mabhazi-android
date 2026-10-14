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
