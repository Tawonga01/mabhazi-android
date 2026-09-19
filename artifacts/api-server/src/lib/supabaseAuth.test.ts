import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthenticationError, createSupabaseAuth, supabaseConfiguration } from "./supabaseAuth";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "public-test-key" };
const verifier = "v".repeat(64);
const user = {
  id: "a5c0014a-e8fc-4428-8dbd-777777777777",
  email: "tester@example.invalid",
  email_confirmed_at: "2026-09-19T00:00:00Z",
  identities: [{ provider: "google" }],
};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }); }

test("PKCE authorization selects Google and SHA256", () => {
  const provider = createSupabaseAuth(env);
  const url = new URL(provider.authorizeUrl("https://api.mabhazi.com/api/callback", "c".repeat(43)));
  assert.equal(url.origin, env.SUPABASE_URL);
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.equal(url.searchParams.get("redirect_to"), "https://api.mabhazi.com/api/callback");
  assert.throws(() => provider.authorizeUrl("https://api.mabhazi.com", "short"));
});

test("code exchange verifies identity independently of token-response profile", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, user: { id: "forged" } })
      : json(user);
  };
  const tokens = await createSupabaseAuth(env, request).exchangeCode("code", verifier);
  assert.equal(tokens.user.id, user.id);
  assert.equal(calls[1].url, env.SUPABASE_URL + "/auth/v1/user");
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer access");
  assert.equal(calls[0].init?.redirect, "error");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { auth_code: "code", code_verifier: verifier });
});

test("rejects invalid tokens, unverified users, and non-Google identities", async () => {
  for (const value of [
    { ...user, id: "not-a-user-id" },
    { ...user, email_confirmed_at: undefined },
    { ...user, identities: [{ provider: "email" }] },
    null,
  ]) {
    const request: typeof fetch = async () => json(value);
    await assert.rejects(createSupabaseAuth(env, request).verifyUser("access"), AuthenticationError);
  }
});

test("provider and network errors never expose secret-bearing messages", async () => {
  for (const request of [
    (async () => json({ error: "secret-refresh-token" }, 401)) as typeof fetch,
    (async () => { throw new Error("secret-refresh-token"); }) as typeof fetch,
  ]) {
    await assert.rejects(createSupabaseAuth(env, request).refresh("secret-refresh-token"), error => {
      assert.equal((error as Error).message, "Authentication failed. Please sign in again.");
      return true;
    });
  }
});

test("rejects missing configuration and invalid PKCE before making a request", async () => {
  assert.throws(() => supabaseConfiguration({}));
  assert.throws(() => supabaseConfiguration({ ...env, SUPABASE_URL: "http://example.com" }));
  const request: typeof fetch = async () => { assert.fail("must not call provider"); };
  await assert.rejects(createSupabaseAuth(env, request).exchangeCode("code", "short"));
});
