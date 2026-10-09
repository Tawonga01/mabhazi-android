import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
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

test("admin signatures reject equivalent noncanonical encodings deterministically", () => {
  const secret = "isolated-admin-test-secret";
  const issuedAt = 1_700_000_000_000;
  const payload = Buffer.from(`${issuedAt + ADMIN_SESSION_TTL_MS}.fixed-test-nonce`).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1)!);
  assert.equal(last % 4, 0);
  assert.equal(verifySignedAdminSession(`${payload}.${signature}`, secret, issuedAt), true);
  for (const lowBits of [1, 2, 3]) {
    const alias = signature.slice(0, -1) + alphabet[last + lowBits];
    assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(signature, "base64url"));
    assert.equal(verifySignedAdminSession(`${payload}.${alias}`, secret, issuedAt), false);
  }
  for (const alias of [signature + "=", signature + "\n", "!" + signature]) {
    assert.equal(verifySignedAdminSession(`${payload}.${alias}`, secret, issuedAt), false);
  }
});

