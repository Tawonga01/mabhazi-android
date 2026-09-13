import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { resolveApiBaseUrl } from "@/lib/api-base";

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = "auth_session_token";
const ISSUER_URL =
  process.env.EXPO_PUBLIC_ISSUER_URL ?? "https://replit.com/oidc";

// expo-secure-store does not work on web — use localStorage there instead.
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(key)
        : null;
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  displayName: string | null;
  lastNameChange: string | null;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  configurationError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  configurationError: null,
  login: async () => {},
  logout: async () => {},
});

function getApiBaseUrl(): string {
  return resolveApiBaseUrl();
}

function getClientId(): string | null {
  const value = process.env.EXPO_PUBLIC_REPL_ID?.trim();
  return value || null;
}

// ─── Web auth provider (uses server-side OIDC redirect flow) ─────────────────

function WebAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const redeemed = useRef(false);

  const apiBase = getApiBaseUrl();

  const fetchUser = useCallback(async () => {
    try {
      const token = await storage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
      } else {
        await storage.removeItem(AUTH_TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  // On mount: check for existing token first, then try to pick up a fresh
  // session cookie that the server-side OAuth flow may have just set.
  useEffect(() => {
    (async () => {
      const existing = await storage.getItem(AUTH_TOKEN_KEY);
      if (existing) {
        await fetchUser();
        return;
      }

      // Attempt to exchange the session cookie → Bearer token.
      // This only succeeds when the browser is on the same origin as the API
      // (i.e. right after the OAuth redirect lands at REPLIT_DEV_DOMAIN/).
      if (apiBase) {
        try {
          const res = await fetch(
            `${apiBase}/api/mobile-auth/session-to-token`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
            },
          );
          const data = await res.json();
          if (data.token) {
            await storage.setItem(AUTH_TOKEN_KEY, data.token);
            redeemed.current = true;
            await fetchUser();
            return;
          }
        } catch {
          // No cookie session available — user is logged out.
        }
      }

      setIsLoading(false);
    })();
  }, [fetchUser, apiBase]);

  const login = useCallback(async () => {
    if (!apiBase || typeof window === "undefined") return;

    const apiOrigin = new URL(apiBase, window.location.href).origin;
    return new Promise<void>((resolve) => {
      const popup = window.open(
        `${apiBase}/api/login?returnTo=/api/auth/done`,
        "auth_popup",
        "width=520,height=640,left=200,top=100",
      );

      if (!popup) {
        // Popup blocked — fall back to full-page redirect
        window.location.href = `${apiBase}/api/login?returnTo=/`;
        resolve();
        return;
      }

      let handled = false;

      const onMessage = async (event: MessageEvent) => {
        if (event.data?.type !== "auth") return;
        if (event.origin !== apiOrigin || event.source !== popup) return;
        if (handled) return;
        handled = true;
        window.removeEventListener("message", onMessage);
        clearInterval(pollTimer);

        const token = event.data?.token;
        if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
          await storage.setItem(AUTH_TOKEN_KEY, token);
          await fetchUser();
        }
        resolve();
      };

      window.addEventListener("message", onMessage);

      const pollTimer = setInterval(() => {
        if (popup.closed) {
          if (!handled) {
            handled = true;
            window.removeEventListener("message", onMessage);
            resolve();
          }
          clearInterval(pollTimer);
        }
      }, 400);
    });
  }, [apiBase, fetchUser]);

  const logout = useCallback(async () => {
    const token = await storage.getItem(AUTH_TOKEN_KEY);
    try {
      if (token && apiBase) {
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {}
    await storage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  }, [apiBase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        configurationError: null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Native auth provider (uses expo-auth-session PKCE flow) ─────────────────

function NativeAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const exchangingRef = useRef(false);

  const discovery = AuthSession.useAutoDiscovery(ISSUER_URL);
  const redirectUri = AuthSession.makeRedirectUri();
  const nonce = useMemo(() => Crypto.randomUUID(), []);
  const clientId = getClientId();
  const configurationError = clientId
    ? null
    : "Sign-in is unavailable because EXPO_PUBLIC_REPL_ID is not configured for this release.";

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      // expo-auth-session requires a non-empty value while hooks are
      // initialised. Never invoke the provider with an empty client ID:
      // login() below turns this sentinel into an explicit configuration
      // error instead of attempting a broken OAuth request.
      clientId: clientId || "missing-replit-client-id",
      scopes: ["openid", "email", "profile", "offline_access"],
      redirectUri,
      prompt: AuthSession.Prompt.Login,
      // expo-auth-session does not expose nonce as a first-class config field.
      // Supplying it as an extra parameter keeps the exact secure value that
      // the server later validates against the signed ID token.
      extraParams: { nonce },
    },
    discovery,
  );

  const apiBase = getApiBaseUrl();

  const fetchUser = useCallback(async () => {
    try {
      const token = await storage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.user) {
        setUser(data.user);
      } else {
        await storage.removeItem(AUTH_TOKEN_KEY);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (response?.type !== "success" || !request?.codeVerifier) return;
    if (exchangingRef.current) return;
    exchangingRef.current = true;

    const { code, state } = response.params;

    (async () => {
      try {
        if (!apiBase || !code || !state || state !== request.state) {
          setIsLoading(false);
          return;
        }
        const exchangeRes = await fetch(
          `${apiBase}/api/mobile-auth/token-exchange`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              code_verifier: request.codeVerifier,
              redirect_uri: redirectUri,
              state,
              nonce,
            }),
          },
        );

        if (!exchangeRes.ok) {
          setIsLoading(false);
          return;
        }

        const data = await exchangeRes.json();
        if (data.token) {
          await storage.setItem(AUTH_TOKEN_KEY, data.token);
          setIsLoading(true);
          await fetchUser();
        }
      } catch {
        console.error("Token exchange failed");
        setIsLoading(false);
      } finally {
        exchangingRef.current = false;
      }
    })();
  }, [response, request, redirectUri, nonce, apiBase, fetchUser]);

  const login = useCallback(async () => {
    if (configurationError) {
      throw new Error(configurationError);
    }
    exchangingRef.current = false;
    try {
      await promptAsync();
    } catch {
      console.error("Login failed");
      throw new Error("Unable to start sign-in.");
    }
  }, [configurationError, promptAsync]);

  const logout = useCallback(async () => {
    const token = await storage.getItem(AUTH_TOKEN_KEY);
    try {
      if (token && apiBase) {
        await fetch(`${apiBase}/api/mobile-auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {}
    await storage.removeItem(AUTH_TOKEN_KEY);
    setUser(null);
  }, [apiBase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        configurationError,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Unified AuthProvider ─────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  if (Platform.OS === "web") {
    return <WebAuthProvider>{children}</WebAuthProvider>;
  }
  return <NativeAuthProvider>{children}</NativeAuthProvider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
