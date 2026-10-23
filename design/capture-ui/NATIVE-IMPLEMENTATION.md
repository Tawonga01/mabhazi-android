# Native capture implementation

Adapts the supplied centred navy/light/orange dialogs to the existing Expo54 application. Original references remain unchanged. Focused Fare is the user-selected default fare editor.

The contribution menu opens the four-answer route form or an independent journey report. Both have explicit review and Save, account-bound encrypted native drafts (web session memory only), current Terms, frozen request keys and receipt-first recovery. Close keeps a draft; removing an optional fact clears its hidden answers. Saved means durable intake, not matched, verified or published information.

Journey reports support actual departure/arrival with their own optional dates/timezones/UTC offsets, observed operator and named pickup/drop-off with their own optional observation dates, selected city and optional knowledge basis, and paid/quoted/advertised city-pair fares. Paid fares require a travel date. Six regional currencies are offered; amount remains a decimal string, including explicit zero. Passenger/ticket conditions require a selection, including Unknown and separate Other descriptions. No currency, adult, one-way, midnight or recurring timetable is invented. Header journey context never fills individual fact scopes. Public-user sign-in and no-email settings are preserved.

Uses existing generated actual-journey and minimum APIs; no database, native package, authentication provider, signing, production configuration or navigation-bar change. Keyboard avoidance and scrolling body/fixed actions require Android device acceptance. Existing full route entry remains accessible.

23 October phone feedback: remove repetitive small print from the capture flow. Forms lead with fields and actions; 24-hour time is stated in its label. Draft retention, receipt references and timezone/context guidance are available through explicit expandable help rather than repeated paragraphs. Successful save says thanks, with its processing state and reference in View receipt. Terms keep an explicit checkbox and readable full Terms link without duplicated instructions. Validation, unknown options, paid/quoted/advertised distinctions, required dates, auth/account/draft/retry behaviour and the original supplied design files remain unchanged. This revision is not in the previously delivered code-2 APK until a new build is signed and installed.

The same copy pass now covers Search, Departures, signed-in/guest Profile, route cards/details, the existing full route form and reporting/block management. Redundant promotional and instructional text is removed; name-change guidance appears during editing. Route cards and operating-day choices have explicit accessible names/states. Fare, operator, pickup/drop-off, contributor attribution, ratings, confirmation counts/dates, errors, actual consent, reporting/blocking/reversal controls and account-deletion consequences remain. Legal/support documents and schedule/confidence calculations are unchanged. The browser fixture exercises these real screens with disposable synthetic legacy data, including edit/cancel and opening/cancelling the deletion dialog without deleting an account. A source review is separate from native/device acceptance; code2 remains the previous source until a new preview build is signed and installed.

24 October navigation icon: the user selected the frontal bus from their supplied Mabhazi logo. Departures now uses that approved isolated trace in both classic and iOS native tabs. The source vector is `artifacts/mobile/assets/images/departures-bus.svg`; transparent24/48/72px PNGs provide the1x/2x/3x native image assets without adding a package. Classic tabs tint the image with their existing active/inactive theme colour; native tabs use the SDK54 custom-image source. The icon remains22px in classic tabs, with the existing label and destinations. Other icons, tab sizing and Android system-inset handling are unchanged. No new phone build or device acceptance is implied by this source change.

## Validation

Local pure-model/storage checks:23 passing (12 existing minimum/recovery +11 journey/fare/storage/retry). Full native TypeScript/Expo exports, real Expo-web-to-restricted-Postgres browser flows and backend CI are required on the exact source commit. A passing browser export is not an APK or phone acceptance.

## Remaining full scope

This is a UI capability within WP08, not its completion or the whole project. Optional facts on a new minimum route still require a typed API; the minimum writer accepts only its four core answers. Full source/citation/import and safe existing-target selection, corrections/reviewer tools, richer fare conditions and full typed forms, generated tasks/prompts, evidence/publication/search, operations/restore, legacy compatibility, multi-user/device/pilot/signed delivery and migration closure remain. Bulletin/live location references are separate unapproved concepts; no GPS/driver data is collected here.

## Contextual capture moments (24 October 2026)

# Contribution moments and popup mapping

24 October2026. User clarification: the missing popup is **Add a route after an empty search**. Further direction: **all popups must be intelligently mapped to the moment they are needed**. This document makes that requirement explicit across WP08/WP09/WP10; it does not claim every mapped form or trigger already exists.

The governing full contract remains [COLLECTION-FLOWS-v1](../../spec/COLLECTION-FLOWS-v1.md), plus the four-field minimum in MASTER-SCOPE. Existing thresholds/cooldowns are configurable pilot settings, not newly approved user facts. No-email/public-user/signing/Android-inset requirements remain.

## Surface map

| Moment | Appropriate invitation/action | Form and retained context | Conditions and exit | Current implementation boundary |
|---|---|---|---|---|
| Search has successfully returned no published routes | **Add a route** | Existing minimum form; carry explicitly chosen departure/destination identities, leave time/operator unset | No approved route needed. Four required fields remain. Opens on tap, closes back to the same search. Saved means intake, not approval | Missing in delivered code3; first fix to implement |
| Search failed or is still loading | Retry / wait | Keep search and any draft | Never interpret failure/loading as evidence of no routes; no empty-result invitation | Add explicit failure handling with first fix |
| Routes exist but local safety settings hide them | Explain hidden results; preserve safety settings | Search remains available | Do not suggest creating a duplicate because results were blocked; do not expose hidden UGC | Separate from true empty results in first fix |
| No search yet | Search or manual Contribute | No inferred route/experience | No unsolicited capture window at app launch | Manual Contribute exists |
| Results show a useful, incomplete route | **Help complete** / a specific missing detail | One typed form bound to selected subject/revision; known context shown | Resolve ambiguous service identity before binding; do not infer that browsing means travel | Context binding/actions still required |
| Route details have no fare | **Add a fare** | Approved Focused Fare, route segment and explicit paid/quoted/advertised basis | Paid requires travel date; preserve currency/passenger/ticket Unknown; no invented fare/defaults | Form exists within Report a journey; route-detail trigger/binding not connected |
| A fare is present but needs an update | **Update fare** | New dated observation of compatible scope | Do not overwrite historical evidence or call the entire route refreshed | Typed context/selection and update path still required |
| Boarding/drop-off point is missing or unclear | **Add pickup/drop-off** | Place form with city/segment and optional observation date/basis | A location name is evidence, not automatic stop/pattern identity | Independent report exists; contextual entry/binding still required |
| Schedule/calendar detail is missing | **Add schedule details** | Explicit scheduled clock/days/date applicability | Actual journey time is a different form. Never infer Daily or turn a trip into a recurring timetable | Full typed schedule/context form remains |
| User explicitly reports their own journey | **Report a journey** | Independent actual time/operator/place/fare facts, each with its own scope/date | Approved route not required; keep unresolved evidence unresolved | Independent report exists; contextual shortcuts remain |
| A newly submitted route is still pending/unapproved | **Add more information** on that saved submission | Bind to the user's actual contribution/subject, not an invented public route | Optional after Saved, never a forced next window. Must work before approval; do not display it as published | Own-contribution access/binding/UI remains |
| Operator/service identity is uncertain | **Which service?** / identification help | Explicit candidate choice or independent report | No automatic merge by city/operator name/time alone; preserve a separate report option | Candidate/review foundations exist; safe public chooser/UI remains |
| Conflicting information is displayed | **Report what you know** / correction | New scoped observation with source/date | Contributor supplies evidence; review authority controls material resolution/reversal | Typed correction/reviewer UI and integration remain |
| User has a timetable, notice or source | **Add a source** | Source/citation/import intake plus observed/source dates | Never equate upload date with when the information was true | Full source intake/form remains |
| User returns to their unfinished entry | **Resume draft** / discard an unsent draft | Same account's exact answers; pending request remains frozen | Never replace it with new search context. Another account cannot adopt it. Explicit resume/review | Shared capture controller exists; reuse it |
| Sign-in or current Terms is required | Sign in / accept Terms at Save | Flush and restore the same draft | No automatically submitted form after return; don't stack another capture over auth/Terms | Shared gates exist; reuse them |
| Save response is lost | **Check and retry** | Same frozen body/key/account; receipt lookup first | Never open a new form that could duplicate the unresolved save | Shared recovery exists; reuse it |
| Save succeeds | Saved acknowledgement; optional Done / user-selected next action | Receipt and truthful intake state | No automatic popup chain; no claim of publication/confidence | Existing acknowledgement/recovery exists |

## Common decision rules

1. Use the actual screen state and the user's selected intent. A manual form remains available regardless of reputation or whether a route is approved.
2. Prefer a visible, concise invitation over automatically opening a form. Opening a form requires a tap. Never interrupt typing, another sheet, auth/Terms, review, submission or receipt recovery.
3. Distinguish successful zero results, service failure, blocked results and incomplete records. These require different actions.
4. Carry verified entity IDs and visible context. Names typed into search are hints until explicitly resolved; do not bind ambiguous city/service names by guessing. A day filter is search intent, not evidence of operation or travel.
5. Reuse the same model, validator, account-scoped encrypted drafts, review, consent and receipt-first submission controller on every surface. Popup presentation must not create another submission pipeline.
6. Preserve existing drafts before considering new prefill. Keep close/back and skip/unknown truthful; an incomplete answer is not a fabricated fact.
7. Prioritise identity, then core schedule/boarding, then relevant other details according to the existing registry. Paid-fare invitations require volunteered paid-travel context. Interest is not experience.
8. Automated invitations need durable server-side tasks, preferences, suppression and revision checks from WP09; do not substitute an ad hoc per-screen client counter. Existing pilot numbers remain configurable and uncalibrated. Manual entry does not depend on unsolicited invitation eligibility.
9. A changed/missing target, conflict or unavailable backend retains the draft and explains the next action. Never silently retarget the contribution.
10. A saved lead, an associated subject, assessed evidence and a published departure remain separate states. Approval cannot gate intake, and intake cannot bypass publication rules.

## First implementation slice

Fix successful empty-search intake first, including loading/error/blocked alternatives, explicitly retained city identity/hints, existing-draft precedence, close/back, guest/Terms handling and real save/retry. Record `search_empty` honestly at the API/database boundary, preserving the old `contribute_tab` clients. Do not mislabel a Search submission merely to avoid updating a narrow API facade. Original applied migrations remain immutable; any required additive facade migration and backend change must be tested before preview application.

Meaningful checks: no approved/legacy routes at all; successful empty search; no popup during loading/error/blocked results; fresh context with unset time/operator; ambiguous/custom names need explicit selection; saved draft wins; close/reopen retains answers; guest/auth/Terms and a lost acknowledgement preserve the same request; one durable submission with `search_empty`; no automatic approval/publication; footer/keyboard/Android inset remains usable.

Then connect typed route-detail and own-pending-submission actions, followed by the remaining forms and durable task-based invitations. Completing the first fix does not complete the map, WP08/WP09/WP10 or R01–R14.

First code slice adds a single root capture host shared by Contribute and successful empty Search, guarded city-ID prefill and additive minimum-intake surface search_empty. Existing account drafts and frozen pending requests take precedence over context. API/database rollout precedes the next signed preview build. Other mapped connections remain unfinished.
