import { type NextFunction, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CURRENT_TERMS_VERSION } from "../lib/terms";

/**
 * Require acceptance of the current terms immediately before a community
 * write.  The lookup is intentionally against the user row instead of the
 * session snapshot so accepting or revoking a version takes effect without
 * re-authentication.
 */
export async function requireCurrentTerms(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [user] = await db
    .select({
      termsAcceptedVersion: usersTable.termsAcceptedVersion,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));

  if (user?.termsAcceptedVersion !== CURRENT_TERMS_VERSION) {
    res.status(428).json({
      error: "Accept the current Mabhazi Terms before submitting community content.",
      code: "TERMS_ACCEPTANCE_REQUIRED",
      currentVersion: CURRENT_TERMS_VERSION,
    });
    return;
  }

  next();
}
