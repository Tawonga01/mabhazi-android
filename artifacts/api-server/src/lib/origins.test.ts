import assert from "node:assert/strict";
import { test } from "node:test";
import { getAllowedOrigins, getPublicOrigin, isAllowedOrigin, normalizeOrigin } from "./origins";

const production = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://api.mabhazi.com" };

test("production requires an explicit HTTPS origin", () => {
  assert.throws(() => getPublicOrigin({ NODE_ENV: "production" }));
  for (const value of ["http://localhost:5000", "https://user:secret@example.com", "https://example.com/path", "https://example.com?x=1", "https://example.com/#x", "example.com"]) {
    assert.throws(() => getPublicOrigin({ ...production, PUBLIC_ORIGIN: value }));
  }
  assert.equal(getPublicOrigin(production), "https://api.mabhazi.com");
});

test("production allows only explicitly configured origins", () => {
  const env = { ...production, ALLOWED_ORIGINS: "https://mabhazi.com, https://www.mabhazi.com" };
  assert.equal(isAllowedOrigin("https://mabhazi.com", env), true);
  for (const origin of ["https://mabhazi.com.attacker.example", "https://attacker.example", "http://localhost:3000", "null", "https://mabhaziv-2.replit.app"]) {
    assert.equal(isAllowedOrigin(origin, env), false);
  }
  assert.throws(() => getAllowedOrigins({ ...production, ALLOWED_ORIGINS: "http://localhost:3000" }));
});

test("development allows local HTTP but not arbitrary insecure hosts", () => {
  assert.equal(getPublicOrigin({}), "http://localhost:5000");
  assert.equal(isAllowedOrigin("http://localhost:8081", {}), true);
  assert.throws(() => normalizeOrigin("http://example.com", true));
});

test("origins normalize trailing slashes and default ports", () => {
  assert.equal(normalizeOrigin(" https://api.mabhazi.com:443/ "), "https://api.mabhazi.com");
});
