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
  const { login, verifyLoginOtp, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 2FA challenge state — when present, swap the form for an OTP entry
  const [otpState, setOtpState] = useState(null);
  const [otpCode, setOtpCode] = useState("");

  React.useEffect(() => {
    if (user && user !== false) navigate(roleToHome(user.role), { replace: true });
  }, [user, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await login(email, password);
    setBusy(false);
    if (r.ok) return; // navigation handled by effect above
    if (r.twoFactorRequired) {
      setOtpState({
        challengeId: r.challengeId,
        sentViaEmail: r.sentViaEmail,
        debugOtp: r.debugOtp,
        email: r.email,
      });
      setOtpCode("");
      return;
    }
    setErr(r.error);
  };

  const onSubmitOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await verifyLoginOtp(otpState.challengeId, otpCode.trim());
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
  };

  const cancelOtp = () => {
    setOtpState(null);
    setOtpCode("");
    setErr("");
  };

  return (
    <div className="login-shell">
      <div className="login-card card animate-in">
        <div className="brand-xl">CloudTax</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 24 }}>Wealthsimple T2 pilot</div>

        {!otpState ? (
          <>
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
            <div className="tertiary" style={{ fontSize: 12, marginTop: 16, textAlign: "center" }}>
              <Link to="/forgot-password" className="link-underline" data-testid="forgot-password-link">Forgot your password?</Link>
            </div>
            <div className="tertiary" style={{ fontSize: 11, marginTop: 12, textAlign: "center" }}>
              Have an invitation? <Link to="/set-password" className="link-underline">Set your password</Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="section-title">Two-factor verification</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
              {otpState.sentViaEmail
                ? <>We sent a 6-digit code to <strong>{otpState.email}</strong>. It expires in 10 minutes.</>
                : <>Email delivery is currently unavailable — use the code shown below to continue. (SES sandbox fallback)</>}
            </p>
            <form onSubmit={onSubmitOtp} className="stack-md" style={{ marginTop: 16 }}>
              <div className="field">
                <label className="field-label">6-digit code</label>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="\d{6}"
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  data-testid="login-otp-input"
                  autoFocus
                  style={{ letterSpacing: 6, fontSize: 18, textAlign: "center" }}
                />
              </div>
              {!otpState.sentViaEmail && otpState.debugOtp && (
                <div
                  style={{
                    background: "var(--bg-subtle)",
                    border: "1px dashed var(--border-default)",
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 12,
                  }}
                  data-testid="login-otp-fallback"
                >
                  <div className="tertiary" style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                    SANDBOX FALLBACK CODE
                  </div>
                  <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 6 }} data-testid="login-otp-fallback-code">
                    {otpState.debugOtp}
                  </code>
                </div>
              )}
              {err && <div className="alert alert-risk" data-testid="login-otp-error">{err}</div>}
              <button className="btn btn-primary w-full" disabled={busy || otpCode.length !== 6} type="submit" data-testid="login-otp-submit">
                {busy ? <span className="spinner" /> : "Verify and sign in"}
              </button>
              <button
                type="button"
                className="btn-link"
                onClick={cancelOtp}
                data-testid="login-otp-cancel"
                style={{ alignSelf: "center", fontSize: 12 }}
              >
                Use a different account
              </button>
            </form>
          </>
        )}
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
