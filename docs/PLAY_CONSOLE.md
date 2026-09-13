# Google Play Console submission pack

This is a factual preparation pack for Mabhazi. It is not a submission, does
not create a Play Console release, and does not promise a production date.
Production remains subject to the signed App Bundle, the Play Console review
and declarations, testing requirements, and operator approval.

## App identity

| Field | Current value | Submission check |
| --- | --- | --- |
| App name | Mabhazi | Confirm the final store name |
| Android application ID | `com.mabhazicom.app` | Must match the signed AAB |
| Version name | `1.0.0` | Confirm before upload |
| First version code | `1` | Increment for every later upload |
| Production API origin | `https://mabhaziv-2.replit.app` | Verify the signed build uses the intended origin |
| Operator | Tawonga Tsokodayi | Legal operator approval required |
| Operator contact | `tawongatsokodayi@gmail.com` | Confirm this is the Play developer contact |
| Operator country/jurisdiction | Not supplied | **Owner decision required; this pack does not guess it** |

## Required public URLs

These source URLs are the intended production URLs. They **need to be
republished and verified live over HTTPS** after the legal copy is integrated;
do not mark them complete based only on local source files.

- Privacy policy: <https://mabhaziv-2.replit.app/api/privacy>
- Account deletion: <https://mabhaziv-2.replit.app/api/delete-account>
- Support and safety reports: <https://mabhaziv-2.replit.app/api/support>

Before submission, open each URL from an external browser and verify that it
returns the current copy, has no development-only host, and links to the other
legal pages. The privacy policy must be accessible in the app and linked in
Play Console. The deletion page must be reachable without requiring a
developer-only tool; the actual deletion action still requires the account
owner to sign in and confirm.

## Data Safety mapping

This mapping reflects the current API, database schema, and mobile client. It
distinguishes information shared publicly with Mabhazi users from information
sent only to the service or its processors. The operator must review the final
Play Console questionnaire, especially the exact treatment of service
providers under Google's definition of “sharing.”

| Play data category | Data collected or generated | Purpose | Required or optional | Sharing and visibility | Deletion / retention notes |
| --- | --- | --- | --- | --- | --- |
| Personal info — email, name, user ID | Replit Auth/OIDC account identifier, email, first/last name, profile-image URL when supplied, Mabhazi display name | App functionality and sign-in | Account identifier and sign-in are required for an account; browsing and anonymous search are available without an account. Profile image and chosen display name are optional claims/settings. | Replit Auth/hosting and the deployed application process the account data. Display name and an available author name can be public beside a contribution or comment. The route API can expose a contributor identifier for attribution, reporting, and blocking. Email and image URL are not intended as public profile data. | Account deletion removes the Mabhazi user row and account-linked records. The separate Replit account is not deleted. No fixed backup/log period is promised. |
| Personal info — authentication information | Server session ID, OAuth access/refresh token material, expiry, and sign-in state | App functionality and security | Required for an authenticated session; not collected for anonymous browsing | Sent between the app and Mabhazi over HTTPS and stored in the server session store. Native mobile session token is stored with `expo-secure-store`; the web version uses browser local storage. Not public. | Sessions are configured to expire after seven days and are removed when encountered or when the account is deleted. |
| App activity — search history | Departure city, destination city, day filter, result count, timestamp, and an optional Mabhazi user ID for signed-in searches | App functionality and aggregate search operations | Search itself is optional; user linkage occurs only when signed in | Not shown as public community content. It is processed by Mabhazi and its hosting/database providers. Anonymous searches have no user ID. | Account deletion removes searches linked to the account. No fixed public retention interval is configured for other search events. |
| User-generated content | Routes, stops, bus details, times, prices, ratings, confirmations, corrections/claims, trip observations, and comments | App functionality and community route information | User-initiated and optional | Route details, contributor display name, ratings/observations, and comments can be public to other Mabhazi users. A comment can show its author display name. This is different from private account credentials. | Account-linked ratings, reports/comments, claims, and contributions are deleted. A shared route can remain with its contributor link and name removed and shown as Anonymous. |
| User-generated content — safety report | Reporter account, route/comment/user target, target ID, reason, optional details, status, moderator notes, reviewer, and review timestamps | App functionality, safety, moderation, and abuse prevention | User-initiated and optional; report details are optional | Sent to the Mabhazi operator/moderators and service processors as needed for review; not intended to be public. Available reasons include sexual content, violent content, harassment, hate speech, spam, personal information, misleading content, and other. | Reports filed by the deleting account are deleted. Moderation references may remain in de-identified audit form where needed for safety. |
| App info and performance — diagnostics | Request ID, HTTP method, path without query string, response status, and error information in operational logs | App functionality, security, and diagnostics | Generated as needed to operate the API | Processed by the deployed service/hosting provider; not public. The current code does not add a crash-reporting SDK or third-party analytics SDK. | No fixed public log-retention period is configured. Operational logs and hosting backups may persist according to the infrastructure lifecycle. |
| Device or other IDs | No device advertising ID or location identifier is used by the current app/server. The local block list contains contributor IDs only on the device. | Not applicable to server collection | Do not declare device-ID collection from the local block list as server collection without confirming Play's questionnaire treatment. | Blocked contributor ID, display name, and block time remain in local app storage and are not uploaded to the Mabhazi API. | User can unblock or clear local app data. Account deletion does not remotely clear this device-only preference. |

### Data Safety declarations to verify

- Declare collection and sharing based on the final Play questionnaire, not only
  the table above.
- Declare that data is encrypted in transit: the API origin is HTTPS and the
  auth/session flows use HTTPS in production.
- Declare account deletion support and provide the external deletion URL above.
  In-app Profile also provides account deletion.
- Do not claim encryption at rest, a fixed backup schedule, or a fixed log
  deletion period; those facts are not established by this repository.
- The current source contains no advertising SDK or third-party analytics
  integration. Confirm the final native build has not added one before making
  any “no ads” or advertising declaration.
- Mabhazi does not sell personal information in the current service. Public
  routes and comments are intentionally shared with other app users, which is
  separate from selling or advertising.
- The app requests no additional Android permissions and the current source
  has no location, camera, media-picker, or notification feature. Recheck the
  final AAB before completing the declarations.

## Privacy, UGC, and account-deletion controls

The current public policy explains:

- Replit hosting and Replit Auth/OIDC identity are separate from a Mabhazi
  account.
- HTTPS/TLS in transit, Secure/HttpOnly/SameSite browser cookies, the native
  OS-backed secure token store, and the less-protected web local-storage
  fallback.
- Public route details, comments, contributor display names, and the separate
  treatment of email, credentials, search linkage, and abuse reports.
- On-device block storage, which is not uploaded and is not removed by server
  account deletion.
- Seven-day session expiry, the absence of fixed public retention periods for
  search events/logs/moderation records, and backup/log limitations.
- Account deletion of active Mabhazi records, anonymization of a retained
  shared route, the treatment of filed abuse reports, and the fact that the
  Replit account is unaffected.
- Access, correction, deletion, restriction, objection, and copy requests
  through the operator email where applicable.

Because Mabhazi includes public user-generated content, the route contribution
flow has terms acceptance, and the app has report controls for routes, comments,
and users, a device-level block control, and operator moderation actions. The
terms prohibit harassment, hate speech, threats/violence, sexual exploitation
or child sexual abuse, illegal content, spam, personal data, impersonation,
fraud/deception, and related objectionable content. Moderation is ongoing and
reports are reviewed using the available tools; no claim is made that review
is instantaneous or perfect.

## Store listing copy

The following copy stays within what the current app actually does and avoids
an unsupported geographic or age claim.

**Short description (under 80 characters)**

> Find and share community bus routes and travel updates.

**Full description**

> Mabhazi helps travelers find community-supplied bus-route information in one
> place.
>
> Search routes by departure, destination, and day. Review times, stops,
> operators, prices, route confidence, confirmations, ratings, and recent
> travel observations. Sign in when you want to contribute a route, correct
> route information, rate a journey, or share an update with other travelers.
>
> Community information can change and may be incomplete or out of date.
> Check important travel details with the relevant transport operator before
> you travel.
>
> Mabhazi includes community safety controls. Report a route, comment, or
> contributor for harassment, hate speech, violence, sexual content, spam,
> personal information, misleading information, or another safety concern.
> Block a contributor on your device when you do not want to see that person's
> community activity. Reports are reviewed through the available moderation
> process, and objectionable content may be hidden or removed.
>
> Review the Mabhazi Privacy notice and Terms before contributing. You can
> delete your Mabhazi account from Profile or use the public account-deletion
> page.

### Listing decisions that require the owner

- **Target audience and age:** no audience or age range is selected in this
  pack. The owner must answer Play's target-audience and content-rating
  questionnaires from the actual intended audience and content; do not infer a
  child-directed or adult-only audience from the moderation policy.
- **Content rating:** complete Google's questionnaire. Do not pre-populate a
  rating here.
- **Ads declaration:** confirm the final binary has no advertising SDK before
  selecting the no-ads response.
- **Operator country/jurisdiction:** missing from the supplied facts and needs
  legal operator approval before submission.
- **Legal copy:** operator must approve the factual privacy, terms, deletion,
  and support wording before republishing.

## Testing and release gates

Google's official testing page says that a **personal** developer account
created after November 13, 2023 must run a closed test with at least 12
testers opted in continuously for at least 14 days, then apply for production
access and answer the Play Console readiness questions. Confirm the account
type and creation date in Play Console; do not assume this requirement applies
or does not apply without checking. An internal test can be useful for the
first AAB check but should not be treated as a substitute for the required
closed test when the rule applies.

Before any production request, the owner should verify:

1. The three public legal URLs above are republished and live.
2. The signed AAB package ID, version code, API origin, OAuth return, and
   account deletion flow work in the intended production environment.
3. The Play Data Safety answers match the deployed binary and the privacy
   notice.
4. The target-audience and content-rating answers are owner decisions.
5. The required testing track and tester duration are complete if applicable.
6. The current target API and page-size guidance is satisfied by the final
   signed AAB; a Metro export or preview cannot prove this.
7. No signing key, service-account key, or secret is committed to the
   repository.

## Official policy references checked for this pack

These are official Google or Android documentation links. Requirements and
Console wording can change, so recheck the linked pages at the time of
submission:

- [App testing requirements for new personal developer
  accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
  — closed-test and production-access requirements.
- [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
  — privacy policy, Data Safety, secure handling, and deletion requirements.
- [User Generated Content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
  — ongoing moderation, terms, reporting, blocking, and prohibited UGC.
- [Meet Google Play's target API level
  requirement](https://developer.android.com/google/play/requirements/target-sdk)
  — current target API levels and effective dates.
- [Support 16 KB page
  sizes](https://developer.android.com/guide/practices/page-sizes) — current
  Android page-size guidance and artifact checks.

No fixed future 16 KB enforcement date is asserted here. Use the current
official page-size guidance and verify the final bundle and native libraries at
each release. No publishing action was performed while preparing this pack.