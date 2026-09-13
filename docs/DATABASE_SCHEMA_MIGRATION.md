# Database schema changes

The UGC moderation release is an additive Drizzle schema change:

- `abuse_reports` is a new table for safety reports.
- `journeys.moderation_status` and `journey_reports.moderation_status` are
  non-null columns with the `visible` default.
- Existing route, report, user, and session rows are not rewritten by the
  schema change.

## Development

Use the workspace's supported Drizzle flow against the Replit **development**
database only:

```sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run verify-schema
```

`push` is idempotent for this additive schema. `verify-schema` is read-only
and checks that the table and columns expected by the API are present. The
post-merge setup runs both commands after dependencies are installed.

Never set `DATABASE_URL` to a production connection for these commands. Do
not add schema DDL to the API startup or deployment build.

## Production

The agent does not mutate production. After the development schema is
verified, publish the application through Replit's Publish flow. Replit
compares the development and production schemas and applies the additive
diff as part of Publish. Review the diff before confirming it; do not use
`psql`, `drizzle-kit push`, `push-force`, or a custom production migration
script against production.

The deployment should be considered ready only after the Publish flow has
completed successfully. If production reports a missing moderation table or
column, re-publish after confirming the development schema rather than
running DDL from the application or a deploy hook.

The production API performs a read-only startup preflight before it begins
listening. It checks that `DATABASE_URL`, `REPL_ID`, and `ADMIN_SECRET` are
present, validates configured HTTPS origins, and verifies the required schema
columns. It reports environment variable names and generic readiness errors
only; it never prints secret values. A missing `ADMIN_SECRET` is a deployment
configuration issue—provide it through the parent Replit Secrets flow rather
than inventing or committing a replacement.

To run the same gate explicitly without starting the API:

```sh
pnpm --filter @workspace/scripts run runtime:preflight
```

## Retention operations

The account deletion transaction removes the account row, every matching
session, account-owned community records, and account-submitted safety
reports. Shared routes remain only without contributor identity. A safety
report submitted by another account about the deleted account can remain as a
minimal moderation record with `target_id = 'deleted-user'` and cleared
free-text fields.

The endpoint cannot retroactively remove copies in database backups,
provider-managed logs, email/support inboxes, or exports. The operator must
define and enforce retention and deletion schedules for those systems,
including any legal hold or safety-audit exception. Do not put passwords,
session tokens, or unnecessary personal information in support requests or
moderator free-text fields.