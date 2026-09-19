import { db, authDeletionJobsTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { supabaseConfiguration } from "./supabaseAuth";

export async function finishIdentityDeletion(userId: string): Promise<boolean> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return false;
  try {
    return await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [job] = await tx.select().from(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, userId));
      if (!job) return true;
      const { url } = supabaseConfiguration();
      const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!response.ok && response.status !== 404) return false;
      await tx.delete(authDeletionJobsTable).where(eq(authDeletionJobsTable.userId, userId));
      return true;
    });
  } catch { return false; }
}

export function startIdentityDeletionWorker(): void {
  let running = false;
  const sweep = async () => {
    if (running || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    running = true;
    try {
      const jobs = await db.select().from(authDeletionJobsTable)
        .orderBy(asc(authDeletionJobsTable.createdAt)).limit(20);
      for (const job of jobs) await finishIdentityDeletion(job.userId);
    } catch {
      // Retry on the next interval; never log provider responses or credentials.
    } finally { running = false; }
  };
  void sweep();
  setInterval(() => void sweep(), 60_000).unref();
}
