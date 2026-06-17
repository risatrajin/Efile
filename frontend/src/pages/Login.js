import React, { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError } from "../lib/api";
import PasswordField from "../components/shared/PasswordField";

function roleToHome(role) {
  if (role === "CLIENT") return "/portal";
  if (role === "PARTNER") return "/partner/dashboard";
  if (role === "CPA") return "/cpa/files";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/";
}

export default function Login() {
  const { login, verifyLoginOtp, user } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const sessionExpired = sp.get("session") === "expired";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 2FA challenge state — when present, swap the form for an OTP entry
  const [otpState, setOtpState] = useState(null);
  const [otpCode, setOtpCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendInfo, setResendInfo] = useState("");

  // Cooldown ticker for the resend button.
  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

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
        expiresInSec: r.expiresInSec || 300,
      });
      setOtpCode("");
      setResendCooldown(r.resendAfterSec || 30);
      setResendInfo("");
      return;
    }
    setErr(r.error);
  };

  const onSubmitOtp = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await verifyLoginOtp(otpState.challengeId, otpCode.trim(), trustDevice);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
  };

  const onResendOtp = async () => {
    if (resendCooldown > 0 || resendBusy) return;
    setResendBusy(true); setErr(""); setResendInfo("");
    try {
      const { data } = await api.post("/auth/2fa/resend", { challenge_id: otpState.challengeId });
      setOtpState({
        challengeId: data.challenge_id,
        sentViaEmail: !!data.sent_via_email,
        debugOtp: data.debug_otp || null,
        email: data.email || otpState.email,
        expiresInSec: data.expires_in_sec || 300,
      });
      setOtpCode("");
      setResendCooldown(data.resend_after_sec || 30);
      setResendInfo(data.sent_via_email ? "A new code has been emailed." : "A new code has been generated.");
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setResendBusy(false);
    }
  };

  const cancelOtp = () => {
    setOtpState(null);
    setOtpCode("");
    setTrustDevice(false);
    setErr("");
    setResendCooldown(0);
    setResendInfo("");
  };

  return (
    <div className="login-shell">
      <div className="login-inner">
        <img
          src="/cloud-tax-logo.svg"
          alt="CloudTax"
          data-testid="login-logo"
          className="auth-logo"
        />
        <div className="login-card card animate-in">
        <h1 className="auth-heading" data-testid="login-heading">Welcome back</h1>
        <div className="muted" style={{ fontSize: 13, marginBottom: 24 }}>Corporate Tax Filing Platform</div>

        {!otpState ? (
          <>
            <h2 className="section-title">Sign in</h2>
            {sessionExpired && (
              <div
                className="alert"
                data-testid="login-session-expired"
                style={{
                  background: "#fff3e0",
                  border: "1px solid #ffcc80",
                  color: "#6b3f10",
                  padding: "10px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  marginTop: 12,
                }}
              >
                Your session expired. Please sign in again to continue.
              </div>
            )}
            <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
              <div className="field">
                <label className="field-label">Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" data-testid="login-email" />
              </div>
              <div className="field">
                <label className="field-label">Password</label>
                <PasswordField
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  testid="login-password"
                  autoComplete="current-password"
                />
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
                ? <>We sent a 6-digit code to <strong>{otpState.email}</strong>. It expires in 5 minutes.</>
                : <>We couldn&rsquo;t deliver the verification email. Tap <em>Resend code</em> below, or contact support@cloudtax.ca if the issue persists.</>}
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
              <label
                htmlFor="login-trust-device"
                className="flex items-center"
                style={{
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px solid var(--border-default)",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontSize: 13,
                  userSelect: "none",
                  background: trustDevice ? "var(--bg-subtle)" : "transparent",
                  transition: "background-color 150ms ease",
                }}
                data-testid="login-trust-device-label"
              >
                <input
                  id="login-trust-device"
                  type="checkbox"
                  checked={trustDevice}
                  onChange={(e) => setTrustDevice(e.target.checked)}
                  data-testid="login-trust-device-checkbox"
                  style={{ width: 16, height: 16, accentColor: "var(--accent-dark)", cursor: "pointer" }}
                />
                <span>
                  <span style={{ fontWeight: 500 }}>I trust this computer for 30 days</span>
                  <span className="muted" style={{ display: "block", fontSize: 11, marginTop: 2 }}>
                    Skip the verification code on this browser for the next 30 days.
                  </span>
                </span>
              </label>
              {!otpState.sentViaEmail && otpState.debugOtp && process.env.NODE_ENV !== "production" && (
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
                    DEV ONLY — NOT SHOWN IN PRODUCTION
                  </div>
                  <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 6 }} data-testid="login-otp-fallback-code">
                    {otpState.debugOtp}
                  </code>
                </div>
              )}
              {err && <div className="alert alert-risk" data-testid="login-otp-error">{err}</div>}
              {resendInfo && <div className="alert" style={{ background: "#e8f5e9", color: "#1b5e20", fontSize: 12 }} data-testid="login-otp-resend-info">{resendInfo}</div>}
              <button className="btn btn-primary w-full" disabled={busy || otpCode.length !== 6} type="submit" data-testid="login-otp-submit">
                {busy ? <span className="spinner" /> : "Verify and sign in"}
              </button>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn-link"
                  onClick={onResendOtp}
                  disabled={resendCooldown > 0 || resendBusy}
                  data-testid="login-otp-resend"
                  style={{ fontSize: 12 }}
                >
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : (resendBusy ? "Sending…" : "Resend code")}
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={cancelOtp}
                  data-testid="login-otp-cancel"
                  style={{ fontSize: 12 }}
                >
                  Use a different account
                </button>
              </div>
            </form>
          </>
        )}
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
  // Invite-info resolution: if the token is valid, fetch the associated email
  // + name so we can hide the raw token and show a friendly read-only summary.
  // ``resolved`` flips once we know the result (either {email,name} or null).
  const [invite, setInvite] = useState(null);
  const [resolved, setResolved] = useState(!initialToken);

  React.useEffect(() => {
    let cancelled = false;
    if (!token) { setResolved(true); return; }
    (async () => {
      try {
        const { data } = await api.get("/auth/invite-info", { params: { token } });
        if (!cancelled) { setInvite(data); setResolved(true); }
      } catch (x) {
        if (!cancelled) {
          // Token is missing / expired / used — show the manual entry fallback
          // so someone with a recovery email can still paste a fresh token.
          setInvite(null);
          setResolved(true);
          setErr(fmtError(x));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

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
        <div className="login-inner">
          <img src="/cloud-tax-logo.svg" alt="CloudTax" className="auth-logo" />
          <div className="login-card card">
          <h2 className="auth-heading" style={{ marginTop: 20 }}>Password set</h2>
          <p className="muted" style={{ fontSize: 13 }}>You can now sign in with your email and new password.</p>
          <Link className="btn btn-primary" to="/login" style={{ marginTop: 16 }} data-testid="goto-login">Sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="login-shell">
        <div className="login-inner">
          <img src="/cloud-tax-logo.svg" alt="CloudTax" className="auth-logo" />
          <div className="login-card card">
          <div className="muted" style={{ marginTop: 20, fontSize: 13 }}>Validating invitation…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-inner">
        <img src="/cloud-tax-logo.svg" alt="CloudTax" className="auth-logo" />
        <div className="login-card card animate-in">
        <h2 className="auth-heading" data-testid="setpwd-heading">Set your password</h2>
        <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
          {invite ? (
            <div className="field">
              <label className="field-label">Account</label>
              <input
                className="input"
                value={invite.email || ""}
                readOnly
                disabled
                data-testid="setpwd-email-readonly"
                style={{ background: "var(--bg-subtle)", cursor: "not-allowed", color: "var(--text-primary)" }}
              />
              {invite.name && (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  You&rsquo;re setting a password for <strong>{invite.name}</strong>.
                </div>
              )}
            </div>
          ) : (
            // Fallback: invite info couldn't be resolved. Keep manual entry but
            // clearly label it "Invitation token" — power-user recovery path.
            <div className="field">
              <label className="field-label">Invitation token</label>
              <input className="input" value={token} onChange={(e) => setToken(e.target.value)} required placeholder="Paste the token from your invite email" data-testid="setpwd-token" />
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Your invite link is either expired or already used. Paste a fresh token to continue, or contact your admin for a new invite.
              </div>
            </div>
          )}
          <div className="field">
            <label className="field-label">New password (min 8 chars)</label>
            <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" testid="setpwd-new" autoComplete="new-password" />
          </div>
          <div className="field">
            <label className="field-label">Confirm password</label>
            <PasswordField value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" testid="setpwd-confirm" autoComplete="new-password" />
          </div>
          {err && <div className="alert alert-risk" data-testid="setpwd-error">{err}</div>}
          <button className="btn btn-primary w-full" disabled={busy || !token} type="submit" data-testid="setpwd-submit">
            {busy ? <span className="spinner" /> : "Set password"}
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
