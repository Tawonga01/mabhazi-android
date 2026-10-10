# Reviewed field interpretation

Migration 0011 connects assessments to field decisions and a per-subject/field/scope review thread. The existing canonical publication gate remains: results are provisional or withheld. Stronger internal support/freshness describes evidence, not a verified route or permission to show timed departures.

## Processing and review

Owner-only `v2_process_field_assessment(assessmentId)` consumes a current assessment, opens or reopens a conflict case when necessary, and projects an evidence-bound field decision. Repeated processing of unchanged evidence, policy, review state and generation returns the current effect. Changed generations create fresh bindings rather than reinstating invalidated history. Assessing observations and processing a field are explicit separate stages; a worker that invokes them with leases remains required.

Owner-only `v2_resolve_field(actor,assessmentId,expectedCaseRevision,expectedSubjectRevision,chosenObservationId,excludedObservationIds,action,reason,privateNote,requestId)` checks an active reviewer role, current assessment, real-time expiry and revisions. Case revision zero means no managed thread exists yet. Accept requires a live chosen observation and explicit removal of incompatible candidates. Reject requires explicit exclusion of every remaining candidate. Exclusions refer only to observations actually present in that assessment. Neither action fabricates a report or a corroborator. Support is recomputed after exclusions, including distinct accounts and disjoint source footprints. Retrying an identical request returns the original receipt; it never restores a withdrawn or reversed choice.

A resolution records all assessed observation IDs, dispositions and evidence fingerprints. Fingerprints bind immutable observation identity, state/target revisions, scope/date/basis and complete origin-component membership. They exclude presentation time and changing freshness labels. A new assessment timestamp, an unrelated field update or an unrelated source change does not by itself turn rejected evidence into a new contradiction. Changed source grouping or a genuinely new eligible claim is reconsidered. If the chosen report disappears, review reopens rather than silently choosing another price/time. Reversal uses the existing revision-bound review operation and invalidates the dependent interpretation.

A managed review thread has one case for its subject/field/scope. Automatic opens/reopens append immutable events identifying the triggering assessment and reason. Existing unrelated manual cases are preserved, not retroactively merged. A future reviewer UI must route field choices through this managed thread and expose any earlier cases. Historical paid/actual contradictions can be reviewed inside the same journey/date/scope without claiming current ongoing freshness. Different currencies remain distinct; no averaging or majority winner is introduced.

## Integrity, privacy and reads

Computed field rows bind the source assessment and optional resolution, with exact scoped evidence membership/dispositions. Legacy provisional rows keep their old validators. Raw histories remain immutable apart from mandated erasure. Current-time `v2_read_field` refuses an invalidated, retired, expired or policy-stale selection. It exposes transport values/status, not private notes or input/source identifiers; historical-clock helpers stay owner-only. APIs must use this boundary rather than raw cached rows.

Observation/source/account erasure removes copied selected values, scopes/digests and rejected-input identifiers; request fingerprints containing actor/private-note input are removed too. Reviewer-only deletion redacts that retry fingerprint and private rationale while preserving independently owned transport evidence. New tables have RLS, backend SELECT only and no client grants. No live reviewer roles or schema changes are applied here.

## Remaining integration

Authenticated actor binding, worker leases/independent runner, reviewer comparison/reversal UI, canonical transport writers and complete downstream task propagation remain required. Selected publication/countdowns remain blocked until canonical identity, calendar/timezone and read-time schedule eligibility are implemented. Affiliation/issuer relationships, prompt/task storage, backfill/recovery, mobile forms/displays, pilot and signed device delivery remain in the full project scope. Exact validation results belong in the checkpoint manifest, not this design document.
