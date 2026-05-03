import React, { useState } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { api, fmtError } from "../../lib/api";

/**
 * Two-factor authentication panel — email OTP based.
 *
 * Flow:
 *  1. User clicks Enable → POST /auth/2fa/enable-init → 6-digit code emailed
 *     (or surfaced inline as a sandbox fallback).
 *  2. User enters code → POST /auth/2fa/enable-confirm → 2FA flagged on account.
 *
 * Disable requires the current password.
 *
 * Props:
 *  - me: current user object (must contain two_factor_enabled)
 *  - onChange: called with the patched user after enable/disable success
 *  - embedded: when true, omit the outer `.card` + section-label so the
 *    component can be slotted inside another SECURITY & PRIVACY card.
 */
export default function TwoFactorCard({ me, onChange, embedded = false }) {
  const enabled = !!me?.two_factor_enabled;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [stage, setStage] = useState("idle"); // idle | enrolling | disabling
  // enroll
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");
  // disable
  const [pwd, setPwd] = useState("");

  const reset = () => {
    setStage("idle");
    setChallenge(null);
    setCode("");
    setPwd("");
    setErr("");
    setInfo("");
  };

  const startEnable = async () => {
    setBusy(true); setErr(""); setInfo("");
    try {
      const { data } = await api.post("/auth/2fa/enable-init");
      if (data.already_enabled) {
        onChange?.({ ...me, two_factor_enabled: true });
        setInfo("2FA is already enabled on this account.");
        return;
      }
      setChallenge({
        challengeId: data.challenge_id,
        sentViaEmail: !!data.sent_via_email,
        debugOtp: data.debug_otp || null,
      });
      setStage("enrolling");
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("/auth/2fa/enable-confirm", {
        challenge_id: challenge.challengeId,
        code: code.trim(),
      });
      onChange?.({ ...me, two_factor_enabled: true });
      setInfo("Two-factor authentication is now enabled.");
      reset();
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  const startDisable = () => { reset(); setStage("disabling"); };

  const confirmDisable = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.post("/auth/2fa/disable", { password: pwd });
      onChange?.({ ...me, two_factor_enabled: false });
      setInfo("Two-factor authentication has been disabled.");
      reset();
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: enabled ? "#e8f5e9" : "var(--bg-subtle)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: enabled ? "#2e7d32" : "var(--text-secondary)",
          }}
        >
          {enabled ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Two-factor authentication</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            {enabled
              ? "Email verification required at every sign-in. We send a 6-digit code that expires in 10 minutes."
              : "Add an extra layer of security. We'll email a 6-digit code each time you sign in."}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span
              className="badge"
              style={{
                background: enabled ? "#e8f5e9" : "var(--bg-subtle)",
                color: enabled ? "#1b5e20" : "var(--text-secondary)",
                fontSize: 10, fontWeight: 600,
              }}
              data-testid="two-factor-status"
            >
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {!enabled && stage === "idle" && (
            <button
              className="btn btn-primary btn-sm"
              onClick={startEnable}
              disabled={busy}
              data-testid="two-factor-enable-btn"
            >Enable 2FA</button>
          )}
          {enabled && stage === "idle" && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={startDisable}
              disabled={busy}
              data-testid="two-factor-disable-btn"
            >Disable</button>
          )}
        </div>
      </div>

      {/* Enrollment OTP step */}
      {stage === "enrolling" && challenge && (
        <form onSubmit={confirmEnable} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-default)" }} data-testid="two-factor-enroll-form">
          <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
            {challenge.sentViaEmail
              ? <>We sent a 6-digit code to <strong>{me?.email}</strong>. Enter it below to enable 2FA.</>
              : <>We couldn&rsquo;t deliver the verification email. Try again in a moment, or contact support@cloudtax.ca if the issue persists.</>}
          </p>
          <div className="field">
            <label className="field-label">Verification code</label>
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              data-testid="two-factor-code"
              style={{ letterSpacing: 6, fontSize: 18, textAlign: "center" }}
              autoFocus
            />
          </div>
          {!challenge.sentViaEmail && challenge.debugOtp && process.env.NODE_ENV !== "production" && (
            <div
              style={{
                background: "var(--bg-subtle)",
                border: "1px dashed var(--border-default)",
                borderRadius: 10, padding: 12, fontSize: 12, marginTop: 10,
              }}
              data-testid="two-factor-fallback"
            >
              <div className="tertiary" style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, marginBottom: 6 }}>
                DEV ONLY — NOT SHOWN IN PRODUCTION
              </div>
              <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 6 }}>{challenge.debugOtp}</code>
            </div>
          )}
          {err && <div className="alert alert-risk mt-2" data-testid="two-factor-err">{err}</div>}
          <div className="flex gap-2 mt-3">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.length !== 6} data-testid="two-factor-confirm">Confirm and enable</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {/* Disable form */}
      {stage === "disabling" && (
        <form onSubmit={confirmDisable} style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border-default)" }} data-testid="two-factor-disable-form">
          <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
            Enter your current password to disable two-factor authentication.
          </p>
          <div className="field">
            <label className="field-label">Current password</label>
            <input
              className="input"
              type="password"
              required
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              data-testid="two-factor-disable-pwd"
              autoFocus
            />
          </div>
          {err && <div className="alert alert-risk mt-2" data-testid="two-factor-err">{err}</div>}
          <div className="flex gap-2 mt-3">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !pwd} data-testid="two-factor-disable-confirm">Disable 2FA</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {info && stage === "idle" && (
        <div className="alert" style={{ background: "#e8f5e9", color: "#1b5e20", marginTop: 14, fontSize: 12 }} data-testid="two-factor-info">{info}</div>
      )}
      {err && stage === "idle" && (
        <div className="alert alert-risk mt-3" data-testid="two-factor-err">{err}</div>
      )}
    </>
  );

  if (embedded) {
    return <div data-testid="two-factor-card">{body}</div>;
  }
  return (
    <div className="card" data-testid="two-factor-card">
      <div className="section-label" style={{ marginBottom: 16 }}>SECURITY &amp; PRIVACY</div>
      {body}
    </div>
  );
}
