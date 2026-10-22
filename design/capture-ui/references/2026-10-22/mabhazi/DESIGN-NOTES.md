# Mabhazi / a little local knowledge

## Direction
**Layout:** centered task dialogs, shared across all five existing screens. Full-viewport navy (#102744) surrounds a compact light panel, not a full-page form or bottom sheet.
**Mood:** restrained Apple-inspired utility. Native system typography, cool porcelain surfaces, quiet grouped fields and orange (#ff9b45) primary actions with dark, high-contrast labels. Small 240ms opacity/transform entrances; reduced motion is respected.

The revision removes the decorative hero, map, bottom navigation, duplicate section introductions and repeated disclaimers. The entry panel offers two concise tasks and draft access. Route extras sit behind a single optional disclosure; validation opens it automatically if an invalid optional answer needs attention. Form labels, required/optional distinctions and inline errors stay visible. One concise prototype disclaimer sits above the dialog; recovery retains essential receipt/submission distinctions.

**Revision checks:** TypeScript passes. All five initial screens were visually checked at 390×844; fare was also checked at 390×450 with Close and primary/Skip controls visible above and below the scrolling body. These are browser-preview checks, not native-keyboard or assistive-technology acceptance tests.

Every preview carries a prototype strip. All people, operators, trips, receipts and dates are synthetic. State is held only in the mounted React component: no network, credentials, device draft persistence or production integration.

## Connected flow
- Contribute → blank route / blank journey; visible example draft → editable route.
- Explore example route → voluntary fare invitation → centered fare dialog. Skip returns to detail; Close exits to Contribute.
- Route/journey → review → simulated saving → committed example or uncertain result.
- Uncertain → simulated receipt check → found / not found → explicit simulated retry of frozen details.
- Supporting-state strip exposes drafts, login, Terms, stale target, saving and success. Login/Terms return to the original form, never auto-submit. Done ends the task; another contribution is voluntary.
- Each preview is an independent session with the same connected shell. Navigation inside a frame preserves its in-memory form.

## Field meanings
- Route: departure city, explicitly chosen departure clock, destination city and typed operator are the only four mandatory answers. 00:00 is valid when chosen. Text input supports unlisted operators. Clock does not imply daily operation. Fare is absent by default.
- Route optional groups: scoped fare, operating-day description and scheduled arrival, boarding/dropoff names, knowledge basis and date. Explicit Remove clears group values. Hidden unselected optional groups are excluded from review.
- Fare: blank amount (zero only when explicitly free), chosen currency, editable directed segment, paid/quoted/advertised basis, passenger and ticket scope. Paid reveals mandatory travel date. Either Other reveals mandatory conditions. Non-paid date is optional.
- Journey: only one chosen fact is necessary. Each actual clock is required only when selected; it has its own optional date and timezone/offset. Overnight example uses separate dates, not inferred chronology. Fare has the same conditional requirements. Operator and place are independent observations, not prerequisites for clocks. Place needs type, name and city, not coordinates. Trip context does not silently fill fact scope. Long names wrap or remain editable in input fields.
- Labels and empty prompts remain visible. Submit validation describes each missing field and focuses the first invalid answer. Facts deselected through chips are excluded from review; explicit section Remove also clears their inputs.

## Review controls
The discreet prototype strip provides Blank, Example (no-fare for routes), Overnight and simulated Keys. The keyboard is visibly an illustration, not a native keyboard emulation. Panels center with balanced space at 390×844 and remain height-constrained at shorter sizes. Headers and form actions are non-scrolling flex regions; only form contents scroll. The simulated keyboard takes space within the panel instead of covering controls. Recovery actions remain reachable within its scrolling body. Short screens retain the centered dialog rather than switching to a full-screen or bottom-sheet pattern. Native-device keyboard behavior still needs device testing.

## Reference pattern register
No reference images were supplied or researched. These are **conceptual inspirations, not rankings or fidelity claims**:
- Google Maps contributions: task chooser, clear subject context and optional enrichment.
- Waze quick reports: pick only the fact you know, reveal just its relevant questions.
- Apple design language: system typography, centered dialogs, grouped fields, quiet separators and one prominent primary action.
- Mabhazi: navy/orange identity, humane unknown states and consent-led invitations.

## Unresolved production dependencies
The supplied handoff describes APIs in another preview, but **none are connected here**. Production needs typed route/journey contracts, complete single-fact APIs, safe target discovery and eligibility, source handling, account/Terms version handling, encrypted account-isolated drafts, frozen-payload idempotency and private receipt recovery. No actual backend availability was verified. Real saving must prevent exits/retries that would conflict with a pending request; demo controls are explicit review tools, not that controller.

Existing-service scheduled facts need dedicated scope and contracts; actual-journey intake is not a replacement. Publication, verification, moderation and contributor history are separate work. The prototype is not installed WP08/WP09 acceptance or actual-device verification. Native keyboard, Android system bars, dynamic text, screen readers and account/connectivity changes still need phone acceptance.
