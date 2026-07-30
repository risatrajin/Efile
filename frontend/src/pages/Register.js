import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import PasswordField from "../components/shared/PasswordField";

function roleToHome(role) {
  if (role === "CLIENT") return "/portal";
  if (role === "PARTNER") return "/partner/dashboard";
  if (role === "CPA") return "/cpa/files";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/";
}

export default function Register() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Ownr handoff tokens will lock the email to the value the partner passed;
  // until that flow lands this is always editable.
  const emailLocked = false;
  // Slot for the partner offer banner ("Offer applied") — rendered above the
  // heading once the handoff flow populates it. Intentionally empty for now.
  const offerBanner = null;

  // Already signed in (or just signed up) → land in the role home.
  React.useEffect(() => {
    if (user && user !== false) navigate(roleToHome(user.role), { replace: true });
  }, [user, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (password.length < 8) return setErr("Use at least 8 characters");
    setBusy(true);
    const r = await register(email, password);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    // navigation handled by the effect above once user lands in context
  };

  return (
    <div className="login-shell">
      <div className="login-inner">
        <img
          src="/cloud-tax-logo.svg"
          alt="CloudTax"
          data-testid="register-logo"
          className="auth-logo"
        />
        <div className="login-card card animate-in">
          {offerBanner}
          <h1 className="auth-heading" data-testid="register-heading">Create your account</h1>
          <div className="muted" style={{ fontSize: 13, marginBottom: 24 }}>Corporate Tax Filing Platform</div>

          <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
            <div className="field">
              <label className="field-label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                readOnly={emailLocked}
                disabled={emailLocked}
                data-testid="register-email"
                style={emailLocked ? { background: "var(--bg-subtle)", cursor: "not-allowed", color: "var(--text-primary)" } : undefined}
              />
            </div>
            <div className="field">
              <label className="field-label">Password</label>
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                testid="register-password"
                autoComplete="new-password"
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Use at least 8 characters.</div>
            </div>
            {err && <div className="alert alert-risk" data-testid="register-error">{err}</div>}
            <button className="btn btn-primary w-full" disabled={busy} type="submit" data-testid="register-submit">
              {busy ? <span className="spinner" /> : "Create account"}
            </button>
          </form>
        </div>
        <div className="auth-footnote" style={{ marginTop: 16 }}>
          Already have an account? <Link to="/login" className="link-underline" data-testid="register-signin-link">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
