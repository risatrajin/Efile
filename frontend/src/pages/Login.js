import React, { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError } from "../lib/api";

function roleToHome(role) {
  if (role === "CLIENT") return "/portal";
  if (role === "WS_PARTNER") return "/ws/dashboard";
  if (role === "CPA") return "/cpa/files";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/";
}

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  React.useEffect(() => {
    if (user && user !== false) navigate(roleToHome(user.role), { replace: true });
  }, [user, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await login(email, password);
    setBusy(false);
    if (!r.ok) setErr(r.error);
  };

  return (
    <div className="login-shell">
      <div className="login-card card animate-in">
        <div className="brand-xl">CloudTax</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 24 }}>Wealthsimple T2 pilot</div>
        <h2 className="section-title">Sign in</h2>
        <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
          <div className="field">
            <label className="field-label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" data-testid="login-email" />
          </div>
          <div className="field">
            <label className="field-label">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Enter your password" data-testid="login-password" />
          </div>
          {err && <div className="alert alert-risk" data-testid="login-error">{err}</div>}
          <button className="btn btn-primary w-full" disabled={busy} type="submit" data-testid="login-submit">
            {busy ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>
        <div className="tertiary" style={{ fontSize: 11, marginTop: 20, textAlign: "center" }}>
          Have an invitation? <Link to="/set-password" className="link-underline">Set your password</Link>
        </div>
      </div>
    </div>
  );
}

export function SetPassword() {
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
      await api.post("/auth/set-password", { token, password });
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
          <div className="brand-xl">CloudTax</div>
          <h2 className="section-title" style={{ marginTop: 20 }}>Password set</h2>
          <p className="muted" style={{ fontSize: 13 }}>You can now sign in with your email and new password.</p>
          <Link className="btn btn-primary" to="/login" style={{ marginTop: 16 }} data-testid="goto-login">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card card animate-in">
        <div className="brand-xl">CloudTax</div>
        <h2 className="section-title" style={{ marginTop: 20 }}>Set your password</h2>
        <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
          <div className="field">
            <label className="field-label">Invitation token</label>
            <input className="input" value={token} onChange={(e) => setToken(e.target.value)} required placeholder="Paste the token from your invite email" data-testid="setpwd-token" />
          </div>
          <div className="field">
            <label className="field-label">New password (min 8 chars)</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Min. 8 characters" data-testid="setpwd-new" />
          </div>
          <div className="field">
            <label className="field-label">Confirm password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Re-enter password" data-testid="setpwd-confirm" />
          </div>
          {err && <div className="alert alert-risk">{err}</div>}
          <button className="btn btn-primary w-full" disabled={busy} type="submit" data-testid="setpwd-submit">
            {busy ? <span className="spinner" /> : "Set password"}
          </button>
        </form>
      </div>
    </div>
  );
}
