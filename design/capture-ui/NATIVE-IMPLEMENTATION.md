# Native capture implementation

Adapts the supplied centred navy/light/orange dialogs to the existing Expo54 application. Original references remain unchanged. Focused Fare is the user-selected default fare editor.

The contribution menu opens the four-answer route form or an independent journey report. Both have explicit review and Save, account-bound encrypted native drafts (web session memory only), current Terms, frozen request keys and receipt-first recovery. Close keeps a draft; removing an optional fact clears its hidden answers. Saved means durable intake, not matched, verified or published information.

Journey reports support actual departure/arrival with their own optional dates/timezones/UTC offsets, observed operator and named pickup/drop-off with their own optional observation dates, selected city and optional knowledge basis, and paid/quoted/advertised city-pair fares. Paid fares require a travel date. Six regional currencies are offered; amount remains a decimal string, including explicit zero. Passenger/ticket conditions require a selection, including Unknown and separate Other descriptions. No currency, adult, one-way, midnight or recurring timetable is invented. Header journey context never fills individual fact scopes. Public-user sign-in and no-email settings are preserved.

Uses existing generated actual-journey and minimum APIs; no database, native package, authentication provider, signing, production configuration or navigation-bar change. Keyboard avoidance and scrolling body/fixed actions require Android device acceptance. Existing full route entry remains accessible.

## Validation

Local pure-model/storage checks:23 passing (12 existing minimum/recovery +11 journey/fare/storage/retry). Full native TypeScript/Expo exports, real Expo-web-to-restricted-Postgres browser flows and backend CI are required on the exact source commit. A passing browser export is not an APK or phone acceptance.

## Remaining full scope

This is a UI capability within WP08, not its completion or the whole project. Optional facts on a new minimum route still require a typed API; the minimum writer accepts only its four core answers. Full source/citation/import and safe existing-target selection, corrections/reviewer tools, richer fare conditions and full typed forms, generated tasks/prompts, evidence/publication/search, operations/restore, legacy compatibility, multi-user/device/pilot/signed delivery and migration closure remain. Bulletin/live location references are separate unapproved concepts; no GPS/driver data is collected here.
