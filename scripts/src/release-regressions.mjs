import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { resolveApiBaseUrl, PRODUCTION_API_BASE_URL } = await import(
  path.join(root, "artifacts/mobile/lib/api-base.ts")
);
const {
  filterBlockedContributors,
  filterBlockedUserContent,
} = await import(path.join(root, "artifacts/mobile/hooks/blockedContent.ts"));
const { parseBlockedContributors } = await import(
  path.join(root, "artifacts/mobile/hooks/blockedContributorStorage.ts")
);
const {
  getMissingProductionEnvironment,
  validateProductionOrigins,
} = await import(path.join(root, "artifacts/api-server/src/preflight.ts"));

assert.equal(resolveApiBaseUrl(""), PRODUCTION_API_BASE_URL);
assert.equal(
  resolveApiBaseUrl("https://preview.example.test/api"),
  "https://preview.example.test",
);
assert.throws(
  () => resolveApiBaseUrl("http://insecure.example.test"),
  /Invalid release API URL/,
);

const blocked = new Set(["user-blocked"]);
assert.deepEqual(
  filterBlockedContributors(
    [
      { id: 1, contributorId: "user-blocked" },
      { id: 2, contributorId: "user-visible" },
      { id: 3, contributorId: null },
    ],
    blocked,
  ).map(({ id }) => id),
  [2, 3],
);
assert.deepEqual(
  filterBlockedUserContent(
    [
      { id: 1, userId: "user-blocked" },
      { id: 2, userId: "user-visible" },
      { id: 3, userId: null },
    ],
    blocked,
  ).map(({ id }) => id),
  [2, 3],
);
assert.deepEqual(
  parseBlockedContributors(
    JSON.stringify([
      { id: "user-blocked", name: "Blocked", blockedAt: "2025-01-01T00:00:00.000Z" },
    ]),
  ),
  [{ id: "user-blocked", name: "Blocked", blockedAt: "2025-01-01T00:00:00.000Z" }],
);
assert.throws(
  () =>
    parseBlockedContributors(
      JSON.stringify([{ id: "user-blocked", name: "Blocked" }]),
    ),
  /malformed/,
);
assert.deepEqual(
  getMissingProductionEnvironment({}),
  ["DATABASE_URL", "REPL_ID", "ADMIN_SECRET"],
);
assert.doesNotThrow(() =>
  validateProductionOrigins({
    PUBLIC_ORIGIN: "https://mabhaziv-2.replit.app",
    EXPO_PUBLIC_API_BASE_URL: "https://mabhaziv-2.replit.app",
  }),
);
assert.throws(
  () =>
    validateProductionOrigins({
      EXPO_PUBLIC_API_BASE_URL: "http://insecure.example.test",
    }),
  /HTTPS origin/,
);

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const openapi = read("lib/api-spec/openapi.yaml");
assert.match(openapi, /\/journeys\/\{id\}\/abuse-reports:/);
assert.match(openapi, /contributorId:/);
assert.match(openapi, /JourneyComment:/);
const generatedClient = read("lib/api-client-react/src/generated/api.ts");
assert.match(generatedClient, /submitAbuseReport/);
assert.match(generatedClient, /`\/api\/journeys\/\$\{id\}\/abuse-reports`/);
assert.match(generatedClient, /`\/api\/journeys\/\$\{id\}\/details`/);
assert.match(read("lib/api-client-react/src/generated/api.schemas.ts"), /contributorId: string \| null/);
const sharedTerms = read("artifacts/mobile/components/TermsAcceptance.tsx");
assert.match(read("artifacts/api-server/src/lib/terms.ts"), /2026-09-12/);
assert.match(sharedTerms, /export function useTermsAcceptance/);
assert.match(sharedTerms, /useGetTermsAcceptanceStatus/);
assert.match(sharedTerms, /useAcceptTerms/);
assert.match(sharedTerms, /testID="terms-acceptance-toggle"/);
assert.match(read("artifacts/mobile/components/JourneyDetailSheet.tsx"), /TermsAcceptanceCard/);
assert.match(read("artifacts/mobile/app/(tabs)/contribute.tsx"), /TermsAcceptanceCard/);
assert.match(read("artifacts/mobile/app/(tabs)/profile.tsx"), /TermsAcceptanceCard/);
assert.match(openapi, /\/terms\/status:/);
assert.match(openapi, /\/terms\/accept:/);
assert.match(generatedClient, /getTermsAcceptanceStatus/);
assert.match(generatedClient, /acceptTerms/);

console.log("release regression checks passed");