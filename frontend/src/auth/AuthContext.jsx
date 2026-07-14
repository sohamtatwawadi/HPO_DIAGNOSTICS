import { createContext, useCallback, useContext, useMemo, useState } from "react";

const TOKEN_KEY = "hpo_auth_token";
const USER_KEY = "hpo_auth_user";
const BASE = import.meta.env.VITE_API_URL ?? "";

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function authRequest(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.detail || parsed.message || text;
    } catch {
      /* keep text */
    }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return JSON.parse(text);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(() => readStoredUser());

  const persist = useCallback((nextToken, nextUser) => {
    setToken(nextToken || "");
    setUser(nextUser || null);
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
    else localStorage.removeItem(TOKEN_KEY);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    else localStorage.removeItem(USER_KEY);
  }, []);

  const logout = useCallback(() => {
    persist("", null);
  }, [persist]);

  const login = useCallback(
    async (email, password) => {
      const data = await authRequest("/api/auth/login", { email, password });
      persist(data.access_token, data.user);
      return data.user;
    },
    [persist]
  );

  const signup = useCallback(
    async (email, password) => {
      const data = await authRequest("/api/auth/signup", { email, password });
      persist(data.access_token, data.user);
      return data.user;
    },
    [persist]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      login,
      signup,
      logout,
    }),
    [token, user, login, signup, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
