# Explicit observation targets

Migration 0008 preserves `original_subject_id` and adds three private tables:
`v2_target_assignments` (immutable reviewed assignments), `v2_target_events`
(contiguous baseline/assign/invalidate history), and `v2_observation_targets`
(current event/assignment). Every observation starts with an unassigned baseline;
its effective subject is its declared origin until explicitly resolved. Upgrade
does not infer targets from existing relationship links or invent past decisions.

Owner-only `v2_resolve_observation_target(observation, association_decision,
expected_target_state_revision, expected_observation_state_revision,
expected_original_subject_revision, expected_destination_subject_revision)`
returns the assignment UUID. It requires the exact active accepted relationship,
current identity review for that candidate, and that specific observation in both
candidate and reviewed evidence. Only directed same_service, same_pattern and
duplicate_of relationships qualify, within the existing endpoint-kind registry.
The candidate must start at the observation's original subject. Known conflicting
operators or directed corridors block assignment even when a review exists. No transitive
identity inference, whole-lead bulk move, nonidentity relation or incompatible
field/subject pair can retarget a report. Matching never converts actual into
scheduled time, unspecified clocks into run facts or pattern facts into run facts.

Replaying an identical observation/association request returns its receipt with
no effect, even after reversal. Changed expected revisions reject. New operations
compare all four supplied revisions under the shared write guard; concurrent
effects cannot silently win at READ COMMITTED or REPEATABLE READ. The primitive
is internal: backend, anon and authenticated roles cannot execute it or write
these tables. A future authenticated/leased transaction must own the actor/worker
boundary before writer grants. Backend SELECT is private, not a public DTO.

When its association/review is invalidated or destination retired, a current link
falls back to the newest still-valid prior assignment, otherwise the origin.
Reversing an older relationship leaves a later valid assignment untouched. Each
change records the exact causal association and prior event. Reassessment of the
same subject under a different decision still invalidates dependent field
decisions: provenance changed. Current field pointers are cleared synchronously;
old/new/original subjects advance generations and queue reassessment. No stale
selection is restored automatically. Fields can use only evidence at its current
effective target; original fields cannot continue double-counting that report.

Withdrawal, moderation and correction invalidate affected links. Restoring
visibility does not reactivate invalidated identity/field decisions. A replacement
starts at its declared origin until independently reviewed. History records what
each explicit assignment meant; no graph union changes unrelated observations.
Account deletion cascades owned target history, erases copied selected facts and
redacts transport snapshots of historical destinations. Historical destinations
receive erase/reassessment work even if the current assignment already fell back.
Unrelated subjects survive. Compound actions may advance generations more than
once; consumers must read the resulting revision/generation.

SQL owns constraints, erasure and RLS; Drizzle supplies query mappings only.
Migration/test evidence is recorded in the maintained project checkpoint. The
fresh/repeated/populated-upgrade and disposable-PostgreSQL tests are required;
code existence alone is not validation or deployment. This does not implement
candidate generation, canonical service materialisation, cross-target review UI,
full source/confidence/freshness, worker leases, public APIs or mobile forms.
Reviewed external-ID resolution, richer endpoint mappings and full canonical
writer history remain explicit integration work. Live apply still requires
inventory, recovery/backfill rehearsal and release acceptance.
