import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SESSION_TTL_MS,
  adminSecretsMatch,
  createSignedAdminSession,
  verifySignedAdminSession,
} from "./adminAuth";

test("admin secret comparison accepts only the exact known test secret", () => {
  const knownTestSecret = "isolated-admin-test-secret";

  assert.equal(adminSecretsMatch(knownTestSecret, knownTestSecret), true);
  assert.equal(adminSecretsMatch("wrong-secret", knownTestSecret), false);
  assert.equal(adminSecretsMatch(undefined, knownTestSecret), false);
  assert.equal(adminSecretsMatch(knownTestSecret, undefined), false);
});

test("signed admin sessions reject tampering, another secret, and expiry", () => {
  const knownTestSecret = "isolated-admin-test-secret";
  const issuedAt = 1_700_000_000_000;
  const token = createSignedAdminSession(knownTestSecret, issuedAt);

  assert.equal(token.includes(knownTestSecret), false);
  assert.equal(verifySignedAdminSession(token, knownTestSecret, issuedAt), true);
  assert.equal(
    verifySignedAdminSession(
      token,
      knownTestSecret,
      issuedAt + ADMIN_SESSION_TTL_MS - 1,
    ),
    true,
  );
  assert.equal(
    verifySignedAdminSession(token, knownTestSecret, issuedAt + ADMIN_SESSION_TTL_MS),
    false,
  );
  assert.equal(
    verifySignedAdminSession(token, "another-isolated-test-secret", issuedAt),
    false,
  );

  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(verifySignedAdminSession(tampered, knownTestSecret, issuedAt), false);
});
