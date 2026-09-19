import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool, authDeletionJobsTable } from "@workspace/db";
import { finishIdentityDeletion } from "./identityDeletion";

after(async () => { await pool.end(); });

test("provider failure retains durable deletion job; retry removes it", async () => {
  const userId = randomUUID();
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const oldServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-public";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  try {
    await db.insert(authDeletionJobsTable).values({ userId });
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.equal(await finishIdentityDeletion(userId), false);
    assert.equal((await db.select().from(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, userId))).length, 1);
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), `https://test.supabase.co/auth/v1/admin/users/${userId}`);
      assert.equal(init?.method, "DELETE");
      assert.equal(init?.redirect, "error");
      return new Response("{}", { status: 200 });
    };
    assert.equal(await finishIdentityDeletion(userId), true);
    assert.equal((await db.select().from(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, userId))).length, 0);
    globalThis.fetch = async () => { assert.fail("completed deletion must not repeat provider request"); };
    assert.equal(await finishIdentityDeletion(userId), true);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({
      SUPABASE_URL: oldUrl, SUPABASE_PUBLISHABLE_KEY: oldKey, SUPABASE_SERVICE_ROLE_KEY: oldServiceKey,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.delete(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, userId));
  }
});
