# Mabhazi capture UI designs

**User choice,22October:** FocusedFare is the default fare pop-up, with extra conditions revealed when needed. See [design decisions](DESIGN-DECISIONS.md). This supersedes the original import's pending default-variant status; other visual choices remain to settle.

User-supplied React/CSS prototypes imported on 22 October 2026 from `Mabhazi-contribution-screen-designs.zip`. Original design source and styles are preserved byte-for-byte under [references/2026-10-22/mabhazi](references/2026-10-22/mabhazi/). [Import manifest](manifest.json) maps each file to its original export path and SHA256/Git blob hash.

## Screen index

| Prototype | Reference | Purpose |
|---|---|---|
| Contribution entry | [Contribute.tsx](references/2026-10-22/mabhazi/Contribute.tsx) | Choose a contribution task or resume an example draft |
| Add route | [AddRoute.tsx](references/2026-10-22/mabhazi/AddRoute.tsx) | Four required answers and optional details |
| Contextual fare | [Fare.tsx](references/2026-10-22/mabhazi/Fare.tsx) | Voluntary fare question in the connected shared prototype |
| Actual journey | [Journey.tsx](references/2026-10-22/mabhazi/Journey.tsx) | Select actual clocks, fare, operator or place observations |
| Recovery | [Recovery.tsx](references/2026-10-22/mabhazi/Recovery.tsx) | Example draft/login/Terms/save/uncertain-receipt states |
| Focused fare variant | [FocusedFare.tsx](references/2026-10-22/mabhazi/FocusedFare.tsx) | Separate focused fare interaction and style |
| Route bulletin concept | [RouteBulletin.tsx](references/2026-10-22/mabhazi/RouteBulletin.tsx) | Illustrative route/location report states |
| Location contribution concept | [LiveLocation.tsx](references/2026-10-22/mabhazi/LiveLocation.tsx) | Illustrative location/update/review flow |

The first five entries share [Prototype.tsx](references/2026-10-22/mabhazi/_shared/Prototype.tsx) and [_group.css](references/2026-10-22/mabhazi/_group.css). Each of the three standalone concepts has a matching CSS file. The author's [DESIGN-NOTES.md](references/2026-10-22/mabhazi/DESIGN-NOTES.md) is retained as supplied. Claims there about earlier visual/type checks are the export author's notes, not newly executed checks by the importing session.

## Visual direction and status

The supplied notes describe compact centred task dialogs, a navy surround, light grouped surfaces, orange primary actions, system typography and restrained motion. This import preserves all supplied variants; it does not infer that one variant supersedes another or that all concepts are approved for implementation.

These are browser React/CSS design references, not React Native components connected to the live app. Demo data, local state, simulated keyboards, saving, login, Terms and receipt checks must remain labelled as prototypes. No backend integration, real data write, encrypted draft durability, device keyboard acceptance or location tracking is delivered by importing them.

## Using the references

These source modules use React hooks, `lucide-react` icons and relative CSS imports. Render them inside a suitable browser prototype host to review the design; they are not a standalone package. The included [reference handoff](references/2026-10-22/README.md) explains what was preserved and what was omitted. No dependency installation, source execution or new visual/browser test was performed for this archival import.

For the application, adapt the selected appearance and flow into the established `artifacts/mobile` React Native/Expo code, preserving:

- Departure city, explicit departure clock, destination city and operator as the new-route minimum; price and knowledge basis optional.
- Typed actual-versus-planned scope, explicit unknowns, conditional fare dates/conditions and account-bound private receipts.
- Shared form validation, public-user access, no-email preference, encrypted native drafts, explicit submit after login/Terms, and receipt-first uncertain-save recovery.
- Android safe-area spacing, real keyboard behaviour, accessibility and existing signing.

Review the focused-fare example's visible USD/adult/single defaults before implementation; an example default must not become an invented observed fact. The bulletin/location designs are preserved as concepts. Live tracking/location permissions, driver information, public location freshness and corresponding data contracts require explicit product/design decisions and implementation; they are not added to the agreed core scope by this import.

## Provenance and next step

The original ZIP remains in the local UI inbox with its checksum recorded in `manifest.json`. Only the 14 Mabhazi-specific design source/style/note files and this import documentation are stored here. Exported Git history, agent/conversation metadata, compiled outputs, generic backend/database stubs and Replit hosting/build configuration were not imported. No Replit runtime or package dependency is introduced.

Next: review the supplied variants with the user, settle the intended screen/flow choices, then implement the chosen native capture UI against the established APIs. Importing references does not finish WP08/WP09, change production, merge the backend PR, deploy a build or satisfy phone acceptance. All remaining project requirements stay open.
