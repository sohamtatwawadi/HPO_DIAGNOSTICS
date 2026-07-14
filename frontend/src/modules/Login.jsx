import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { C } from "../tokens";

export default function Login() {
  const { isAuthenticated, login, signup } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/variant-file-prioritization" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await signup(email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.pageBg,
        fontFamily: C.fontUi,
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: C.card,
          borderRadius: 12,
          border: `1px solid ${C.border}`,
          boxShadow: C.shadow,
          padding: "32px 28px",
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: C.text,
            letterSpacing: "-0.02em",
            marginBottom: 20,
          }}
        >
          VarMatch<span style={{ color: C.accent }}>.AI</span>
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: 20, color: C.text }}>
          {mode === "login" ? "Log in" : "Create account"}
        </h1>
        <p style={{ margin: "0 0 24px", fontSize: 14, color: C.textSecondary, lineHeight: 1.5 }}>
          Sign in to run analyses and save cases to your account.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${C.borderEmphasis}`,
              fontSize: 14,
              marginBottom: 16,
              fontFamily: C.fontUi,
            }}
          />

          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${C.borderEmphasis}`,
              fontSize: 14,
              marginBottom: 8,
              fontFamily: C.fontUi,
            }}
          />
          {mode === "signup" && (
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
              At least 8 characters.
            </div>
          )}

          {error && (
            <div
              style={{
                background: "#FEF2F2",
                color: C.red,
                padding: "10px 12px",
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 8,
              border: "none",
              background: C.accent,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: busy ? "wait" : "pointer",
              opacity: busy ? 0.7 : 1,
              fontFamily: C.fontUi,
            }}
          >
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: 14, color: C.textSecondary, textAlign: "center" }}>
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: C.accent,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: C.fontUi,
                  padding: 0,
                }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: C.accent,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: C.fontUi,
                  padding: 0,
                }}
              >
                Log in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
