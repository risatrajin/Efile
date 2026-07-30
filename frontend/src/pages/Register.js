import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../lib/api";
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
  const [searchParams] = useSearchParams();
  const handoffToken = searchParams.get("token") || null;

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Handoff prefill state: null = no token / not checked yet, undefined while
  // loading, otherwise the /auth/handoff-info payload (or {valid:false, ...}).
  const [handoffInfo, setHandoffInfo] = useState(handoffToken ? undefined : null);

  React.useEffect(() => {
    if (!handoffToken) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/auth/handoff-info", { params: { token: handoffToken } });
        if (!cancelled) setHandoffInfo(data);
      } catch {
        if (!cancelled) setHandoffInfo({ valid: false, ownr_return_url: null });
      }
    })();
    return () => { cancelled = true; };
  }, [handoffToken]);

  React.useEffect(() => {
    if (handoffInfo && handoffInfo.valid) {
      if (handoffInfo.email) setEmail(handoffInfo.email);
      if (handoffInfo.first_name) setFirstName(handoffInfo.first_name);
      if (handoffInfo.last_name) setLastName(handoffInfo.last_name);
    }
  }, [handoffInfo]);

  const emailLocked = !!(handoffInfo && handoffInfo.valid && handoffInfo.email_locked);
  const isOwnrFlow = !!(handoffInfo && handoffInfo.valid);
  const offerBanner = isOwnrFlow ? (
    <div className="alert" style={{ background: "#f5f0ff", border: "1px solid #ddd0fa", color: "#4c30a0", marginBottom: 16 }} data-testid="register-offer-banner">
      Ownr offer applied
    </div>
  ) : null;

  // Already signed in (or just signed up) → land in the role home.
  React.useEffect(() => {
    if (user && user !== false) navigate(roleToHome(user.role), { replace: true });
  }, [user, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!firstName.trim() || !lastName.trim()) return setErr("First and last name are required");
    if (password.length < 8) return setErr("Use at least 8 characters");
    if (isOwnrFlow && !consent) return setErr("Please review and accept the data-sharing consent to continue.");
    setBusy(true);
    const extra = {
      first_name: firstName,
      last_name: lastName,
      ...(isOwnrFlow ? { handoff_token: handoffToken, consent } : {}),
    };
    const r = await register(email, password, extra);
    setBusy(false);
    if (!r.ok) setErr(r.error);
    // navigation handled by the effect above once user lands in context
  };

  // Invalid / expired / used token — friendly error state, no form.
  if (handoffToken && handoffInfo && handoffInfo.valid === false) {
    return (
      <div className="login-shell ownr-portal">
        <div className="login-inner">
          <img src="/cloud-tax-logo.svg" alt="CloudTax" className="auth-logo" />
          <div className="login-card card animate-in">
            <h1 className="auth-heading" data-testid="register-heading">This link has expired</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, marginBottom: 24 }}>
              This Ownr signup link is no longer valid. Head back to Ownr to get a fresh one, or continue with a regular CloudTax signup.
            </div>
            {handoffInfo.ownr_return_url && (
              <a className="btn btn-primary w-full" href={handoffInfo.ownr_return_url} data-testid="back-to-ownr">
                Back to Ownr
              </a>
            )}
            <div className="auth-footnote" style={{ marginTop: 16 }}>
              <Link to="/register" className="link-underline" data-testid="register-plain-link">Continue without a partner offer</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading the handoff prefill — avoid flashing the plain form first.
  if (handoffToken && handoffInfo === undefined) {
    return <div className="login-shell" />;
  }

  return (
    <div className={`login-shell${isOwnrFlow ? " ownr-portal" : ""}`}>
      <div className="login-inner">
        {isOwnrFlow ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
            <img src="/cloud-tax-logo.svg" alt="CloudTax" data-testid="register-logo" className="auth-logo" style={{ marginBottom: 0 }} />
            <span className="muted" style={{ fontSize: 13 }}>+</span>
            <img src="/ownr-logo.svg" alt="Ownr" data-testid="register-ownr-logo" style={{ height: 24, width: "auto" }} />
          </div>
        ) : (
          <img
            src="/cloud-tax-logo.svg"
            alt="CloudTax"
            data-testid="register-logo"
            className="auth-logo"
          />
        )}
        <div className="login-card card animate-in">
          {offerBanner}
          <h1 className="auth-heading" data-testid="register-heading">Create your account</h1>
          <div className="muted" style={{ fontSize: 13, marginBottom: 24 }}>Corporate Tax Filing Platform</div>

          <form onSubmit={onSubmit} className="stack-md" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">First name</label>
                <input
                  className="input"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  data-testid="register-first-name"
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field-label">Last name</label>
                <input
                  className="input"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  data-testid="register-last-name"
                />
              </div>
            </div>
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
            {isOwnrFlow && (
              <div className="field" style={{ background: "var(--bg-subtle)", borderRadius: 8, padding: 12 }} data-testid="register-consent">
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Ownr shared with CloudTax:</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {handoffInfo.email && <li>Email address</li>}
                    {(handoffInfo.first_name || handoffInfo.last_name) && <li>Name</li>}
                    {handoffInfo.company_name && <li>Company name ({handoffInfo.company_name})</li>}
                    {handoffInfo.has_entitlement && <li>Your Ownr offer</li>}
                  </ul>
                  <div style={{ fontWeight: 600, margin: "8px 0 4px" }}>CloudTax will share back with Ownr:</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Registration and filing status</li>
                    <li>CRA confirmation number</li>
                    <li>Filing completion date</li>
                    <li>Service selected</li>
                  </ul>
                  <div style={{ marginTop: 8 }}>
                    CloudTax never shares your tax return details without your explicit authorization.
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    data-testid="register-consent-checkbox"
                    style={{ marginTop: 2 }}
                  />
                  <span>I agree to the information sharing described above.</span>
                </label>
              </div>
            )}
            {err && <div className="alert alert-risk" data-testid="register-error">{err}</div>}
            <button className="btn btn-primary w-full" disabled={busy} type="submit" data-testid="register-submit">
              {busy ? <span className="spinner" /> : "Create account"}
            </button>
          </form>
        </div>
        <div className="auth-footnote" style={{ marginTop: 16 }}>
          Already have an account? <Link to="/login" className="link-underline" data-testid="register-signin-link">Sign in</Link>
        </div>
        {isOwnrFlow && handoffInfo.ownr_return_url && (
          <div className="auth-footnote" style={{ marginTop: 8 }}>
            <a href={handoffInfo.ownr_return_url} className="link-underline" data-testid="back-to-ownr">← Back to Ownr</a>
          </div>
        )}
      </div>
    </div>
  );
}
