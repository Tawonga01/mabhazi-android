import { normalizeOrigin } from "./origins";

type Environment = Record<string, string | undefined>;
type Fetch = typeof fetch;

export interface SupabaseIdentity {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  identities: Array<{ provider: string }>;
}

export interface SupabaseTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: SupabaseIdentity;
}

export class AuthenticationError extends Error {
  constructor() { super("Authentication failed. Please sign in again."); }
}

export function supabaseConfiguration(env: Environment = process.env) {
  const url = normalizeOrigin(env.SUPABASE_URL ?? "");
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  return { url, key };
}

/** Kept separate from app sessions: never accept the browser's asserted user ID. */
export function createSupabaseAuth(env: Environment = process.env, request: Fetch = fetch) {
  const { url, key } = supabaseConfiguration(env);

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    try {
      const response = await request(`${url}/auth/v1${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { apikey: key, "Content-Type": "application/json", ...init.headers },
      });
      if (!response.ok) throw new AuthenticationError();
      return await response.json();
    } catch {
      // Provider errors can contain authorization codes, tokens, or profile data.
      throw new AuthenticationError();
    }
  }

  async function verifyUser(accessToken: string): Promise<SupabaseIdentity> {
    const raw = await call("/user", { headers: { Authorization: `Bearer ${accessToken}` } });
    const user = raw as Partial<SupabaseIdentity> & { email_confirmed_at?: unknown };
    if (!user || typeof user.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ||
        typeof user.email !== "string" || !user.email ||
        typeof user.email_confirmed_at !== "string" ||
        !Array.isArray(user.identities) ||
        !user.identities.some(identity => identity?.provider === "google")) {
      throw new AuthenticationError();
    }
    return user as SupabaseIdentity;
  }

  async function tokens(grant: string, body: Record<string, string>): Promise<SupabaseTokens> {
    const raw = await call(`/token?grant_type=${grant}`, { method: "POST", body: JSON.stringify(body) });
    const token = raw as Record<string, unknown> | null;
    if (!token || typeof token.access_token !== "string" || !token.access_token ||
        typeof token.refresh_token !== "string" || !token.refresh_token ||
        typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) ||
        token.expires_in <= 0) throw new AuthenticationError();
    const user = await verifyUser(token.access_token);
    return {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
      user,
    };
  }

  return {
    authorizeUrl(redirectTo: string, challenge: string): string {
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new AuthenticationError();
      const target = new URL(`${url}/auth/v1/authorize`);
      target.searchParams.set("provider", "google");
      target.searchParams.set("redirect_to", redirectTo);
      target.searchParams.set("code_challenge", challenge);
      target.searchParams.set("code_challenge_method", "s256");
      return target.href;
    },
    exchangeCode(code: string, verifier: string): Promise<SupabaseTokens> {
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !code || code.length > 2048) {
        return Promise.reject(new AuthenticationError());
      }
      return tokens("pkce", { auth_code: code, code_verifier: verifier });
    },
    refresh(refreshToken: string): Promise<SupabaseTokens> {
      return tokens("refresh_token", { refresh_token: refreshToken });
    },
    verifyUser,
  };
}
