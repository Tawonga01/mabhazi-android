import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, test } from "node:test";

let server: Server;
let baseUrl: string;
before(async () => {
  process.env.PUBLIC_ORIGIN = "https://api.mabhazi.com";
  process.env.ALLOWED_ORIGINS = "https://mabhazi.com,https://api.mabhazi.com";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
  const { default: app } = await import("../app");
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const { pool } = await import("@workspace/db");
  await pool.end();
});

test("website login redirects to the API before setting its verifier cookie", async () => {
  const response = await fetch(baseUrl + "/api/login?returnTo=%2Fapi%2Fdelete-account", {
    redirect: "manual", headers: { host: "mabhazi.com" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://api.mabhazi.com/api/login?returnTo=%2Fapi%2Fdelete-account");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("API login binds a secure PKCE cookie to the registered callback", async () => {
  const response = await fetch(baseUrl + "/api/login?returnTo=https://attacker.invalid", {
    redirect: "manual", headers: { host: "api.mabhazi.com" },
  });
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location")!);
  assert.equal(target.origin, "https://example.supabase.co");
  assert.equal(target.searchParams.get("redirect_to"), "https://api.mabhazi.com/api/callback");
  assert.equal(target.searchParams.get("code_challenge_method"), "s256");
  assert.match(target.searchParams.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(value => value.startsWith("code_verifier=") && value.includes("HttpOnly") && value.includes("Secure")));
  assert.ok(cookies.some(value => value.startsWith("return_to=%2F;")));
});

test("mobile login rejects invalid PKCE and ignores caller-supplied callbacks", async () => {
  const invalid = await fetch(baseUrl + "/api/mobile-auth/start", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code_challenge: "short" }),
  });
  assert.equal(invalid.status, 400);
  const response = await fetch(baseUrl + "/api/mobile-auth/start", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: "a".repeat(43), redirect_to: "https://attacker.invalid" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { url: string };
  assert.equal(new URL(body.url).searchParams.get("redirect_to"), "mabhazicom://auth/callback");
});
