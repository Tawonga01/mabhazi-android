import { createSupabaseAuth } from "../lib/supabaseAuth";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import {
  clearSession,
  getSessionId,
  getSession,
  updateSession,
  type SessionData,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const tokens = await createSupabaseAuth().refresh(session.refresh_token);
    if (tokens.user.id !== session.user.id) return null;
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token;
    session.expires_at = tokens.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    next();
    return;
  }

  // A deleted account must never remain authenticated through a stale snapshot.
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, refreshed.user.id));
  if (!user) {
    await clearSession(res, sid);
    next();
    return;
  }
  req.user = {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    profileImageUrl: user.profileImageUrl, displayName: user.displayName ?? null,
    lastNameChange: user.lastNameChange ?? null,
  };
  next();
}
