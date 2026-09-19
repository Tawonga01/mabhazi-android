import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import * as SecureStore from "expo-secure-store";
import { resolveApiBaseUrl } from "@/lib/api-base";

WebBrowser.maybeCompleteAuthSession();

const AUTH_TOKEN_KEY = "mabhazi_session_v2";

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

// ─── Web auth provider (uses server-side Google redirect flow) ─────────────────

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
      // (i.e. right after the OAuth redirect lands at the configured API origin).
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

// ─── Native auth provider (uses Google via Supabase with PKCE) ─────────────────

function NativeAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const loginInProgress = useRef(false);
  const apiBase = getApiBaseUrl();

  const fetchUser = useCallback(async () => {
    const token = await storage.getItem(AUTH_TOKEN_KEY);
    if (!token) { setUser(null); setIsLoading(false); return; }
    try {
      const response = await fetch(`${apiBase}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Account lookup failed");
      const data = await response.json();
      setUser(data.user ?? null);
      if (!data.user) await storage.removeItem(AUTH_TOKEN_KEY);
    } finally { setIsLoading(false); }
  }, [apiBase]);

  useEffect(() => {
    fetchUser().catch(() => setUser(null));
  }, [fetchUser]);

  const login = useCallback(async () => {
    if (loginInProgress.current) return;
    loginInProgress.current = true;
    const redirectUri = "mabhazicom://auth/callback";
    // Fresh verifier per attempt. It never leaves this device except over HTTPS
    // to the backend during the single-use code exchange.
    const verifier = (Crypto.randomUUID() + Crypto.randomUUID()).replace(/-/g, "");
    try {
      const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
        encoding: Crypto.CryptoEncoding.BASE64,
      });
      const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const started = await fetch(`${apiBase}/api/mobile-auth/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code_challenge: challenge }),
      });
      if (!started.ok) throw new Error("Unable to start Google sign-in.");
      const { url } = await started.json();
      if (typeof url !== "string" || new URL(url).protocol !== "https:") {
        throw new Error("Invalid sign-in configuration.");
      }
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      if (result.type !== "success") return;
      const callback = new URL(result.url);
      if (callback.protocol !== "mabhazicom:" || callback.hostname !== "auth" ||
          callback.pathname !== "/callback" || callback.username || callback.password ||
          callback.searchParams.has("error")) {
        throw new Error("Google sign-in was not completed.");
      }
      const code = callback.searchParams.get("code");
      if (!code) throw new Error("Sign-in expired. Please try again.");
      const exchanged = await fetch(`${apiBase}/api/mobile-auth/token-exchange`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier }),
      });
      if (!exchanged.ok) throw new Error("Sign-in failed. Please try again.");
      const data = await exchanged.json();
      if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token)) {
        throw new Error("Sign-in failed. Please try again.");
      }
      await storage.setItem(AUTH_TOKEN_KEY, data.token);
      setIsLoading(true);
      await fetchUser();
    } finally {
      loginInProgress.current = false;
      setIsLoading(false);
    }
  }, [apiBase, fetchUser]);

  const logout = useCallback(async () => {
    const token = await storage.getItem(AUTH_TOKEN_KEY);
    try {
      if (token) await fetch(`${apiBase}/api/mobile-auth/logout`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      await storage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
    }
  }, [apiBase]);

  return <AuthContext.Provider value={{
    user, isLoading, isAuthenticated: !!user, configurationError: null, login, logout,
  }}>{children}</AuthContext.Provider>;
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
