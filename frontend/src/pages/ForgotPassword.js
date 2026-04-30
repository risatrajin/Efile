import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtError } from "../lib/api";
import PasswordField from "../components/shared/PasswordField";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [sentViaEmail, setSentViaEmail] = useState(false);
  const [resetLink, setResetLink] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/auth/forgot-password", { email });
      setSubmitted(true);
      setSentViaEmail(!!data.sent_via_email);
      setResetLink(data.reset_link || null);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card card animate-in">
        <img src="/cloud-tax-logo.svg" alt="CloudTax" style={{ height: 24, width: "auto", display: "block", marginBottom: 20 }} />
        <div className="muted" style={{ fontSize: 12, marginBottom: 24 }}>Reset your password</div>
        <h2 className="section-title">Forgot password</h2>

        {!submitted && (
          <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              Enter the email associated with your account. We'll send you a link to reset your password.
            </p>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="input" type="email" required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                data-testid="forgot-email"
              />
            </div>
            {err && <div className="alert alert-risk" data-testid="forgot-error">{err}</div>}
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={busy || !email}
              data-testid="forgot-submit"
            >
              {busy ? <span className="spinner" /> : "Send reset link"}
            </button>
            <div className="tertiary" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
              Remembered it? <Link to="/login" className="link-underline">Back to sign in</Link>
            </div>
          </form>
        )}

        {submitted && (
          <div className="stack-md" style={{ marginTop: 16 }} data-testid="forgot-result">
            <div
              className="alert"
              style={{
                background: "#e8f5e9",
                border: "1px solid #c8e6c9",
                color: "#1b5e20",
                padding: 14,
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.6,
              }}
              data-testid="forgot-success-msg"
            >
              If <strong>{email}</strong> matches an account, we've started a password reset.
              {sentViaEmail
                ? " Check your inbox for the reset link."
                : " Email delivery is currently unavailable — use the link below to continue."}
            </div>

            {resetLink && (
              <div
                style={{
                  background: "var(--bg-subtle)",
                  border: "1px dashed var(--border-default)",
                  borderRadius: 10,
                  padding: 14,
                }}
                data-testid="forgot-fallback"
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5, marginBottom: 8 }}>
                  RESET LINK (FALLBACK)
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)", marginBottom: 10 }}>
                  Click below to set a new password. This link expires in 30 minutes.
                </div>
                <Link
                  to={resetLink.replace(/^.*\/reset-password/, "/reset-password")}
                  className="btn btn-primary w-full"
                  data-testid="forgot-fallback-cta"
                >
                  Open reset page
                </Link>
                <code
                  style={{
                    display: "block",
                    marginTop: 10,
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    wordBreak: "break-all",
                  }}
                  data-testid="forgot-fallback-link"
                >
                  {resetLink}
                </code>
              </div>
            )}

            <Link to="/login" className="btn btn-secondary w-full" data-testid="forgot-back-login">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const initialToken = sp.get("token") || "";
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (password !== confirm) return setErr("Passwords do not match");
    if (password.length < 8) return setErr("Use at least 8 characters");
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="login-shell">
        <div className="login-card card">
          <img src="/cloud-tax-logo.svg" alt="CloudTax" style={{ height: 24, width: "auto", display: "block", marginBottom: 20 }} />
          <h2 className="section-title" style={{ marginTop: 20 }}>Password reset</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Your password has been updated. You can now sign in with your new password.
          </p>
          <button
            className="btn btn-primary w-full"
            style={{ marginTop: 16 }}
            onClick={() => navigate("/login", { replace: true })}
            data-testid="reset-goto-login"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card card animate-in">
        <img src="/cloud-tax-logo.svg" alt="CloudTax" style={{ height: 24, width: "auto", display: "block", marginBottom: 20 }} />
        <h2 className="section-title" style={{ marginTop: 20 }}>Set a new password</h2>
        <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
          {!initialToken && (
            <div className="field">
              <label className="field-label">Reset token</label>
              <input
                className="input" required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the token from your reset link"
                data-testid="reset-token"
              />
            </div>
          )}
          <div className="field">
            <label className="field-label">New password (min 8 chars)</label>
            <PasswordField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              testid="reset-new"
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label className="field-label">Confirm password</label>
            <PasswordField
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              testid="reset-confirm"
              autoComplete="new-password"
            />
          </div>
          {err && <div className="alert alert-risk" data-testid="reset-error">{err}</div>}
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || !token || !password || !confirm}
            data-testid="reset-submit"
          >
            {busy ? <span className="spinner" /> : "Update password"}
          </button>
          <div className="tertiary" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
            <Link to="/login" className="link-underline">Back to sign in</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
