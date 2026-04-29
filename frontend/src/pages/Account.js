import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api, fmtError } from "../lib/api";
import { LogOut, ShieldCheck, KeyRound, BookOpen, Download, Phone, Camera, Trash2 } from "lucide-react";
import AppHeader from "../components/shared/AppHeader";
import UserAvatar from "../components/shared/UserAvatar";

function Toggle({ checked, onChange, testid }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      data-testid={testid}
      style={{
        width: 38, height: 22, borderRadius: 999, padding: 2, position: "relative",
        background: checked ? "#1565c0" : "#d9d5cf",
        transition: "background-color 200ms ease",
      }}
    >
      <span style={{
        display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff",
        transform: checked ? "translateX(16px)" : "translateX(0)",
        transition: "transform 200ms ease", boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
      }} />
    </button>
  );
}

function ToggleRow({ label, value, onChange, testid }) {
  return (
    <div className="list-row" style={{ background: "var(--bg-subtle)", padding: "14px 16px", borderRadius: 10, borderBottom: "none", marginBottom: 8 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <Toggle checked={!!value} onChange={onChange} testid={testid} />
    </div>
  );
}

function InfoRow({ label, value, editing, onChange, testid }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {editing ? (
        <input className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      ) : (
        <div style={{ fontSize: 14, fontWeight: 500, paddingTop: 2 }} data-testid={testid}>{value || "—"}</div>
      )}
    </div>
  );
}

function AvatarUploadCard({ me, setMe, setUser }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Cache-bust query param so the new image renders immediately after upload
  const [bust, setBust] = useState(() => Date.now());

  const userForAvatar = me?.avatar_url
    ? { ...me, avatar_url: `${me.avatar_url}?v=${bust}` }
    : me;

  const onPick = () => { inputRef.current?.click(); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      setErr("Please select an image file (PNG, JPEG, WebP or GIF).");
      e.target.value = "";
      return;
    }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/users/me/avatar", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const next = { ...me, avatar_url: data.avatar_url };
      setMe(next);
      setUser((u) => (u && typeof u === "object" ? { ...u, avatar_url: data.avatar_url } : u));
      setBust(Date.now());
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setErr(""); setBusy(true);
    try {
      await api.delete("/users/me/avatar");
      const next = { ...me };
      delete next.avatar_url;
      setMe(next);
      setUser((u) => {
        if (!u || typeof u !== "object") return u;
        const copy = { ...u };
        delete copy.avatar_url;
        return copy;
      });
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="avatar-upload-card">
      <div className="section-label" style={{ marginBottom: 16 }}>PROFILE PICTURE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <UserAvatar user={userForAvatar} size={80} testid="avatar-upload-preview" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{me.name}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            PNG, JPEG, WebP or GIF · max 4 MB. We&apos;ll use a colourful initials avatar if none is set.
          </div>
          <div className="flex gap-2 mt-3">
            <button
              className="btn btn-primary btn-sm"
              onClick={onPick}
              disabled={busy}
              data-testid="avatar-upload-btn"
            >
              <Camera size={12} /> {me.avatar_url ? "Change photo" : "Upload photo"}
            </button>
            {me.avatar_url && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={onRemove}
                disabled={busy}
                data-testid="avatar-remove-btn"
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          {err && <div className="alert alert-risk mt-2" data-testid="avatar-upload-err">{err}</div>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onFile}
        style={{ display: "none" }}
        data-testid="avatar-upload-input"
      />
    </div>
  );
}

export default function AccountPage() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState("");
  const [pwDone, setPwDone] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/users/me/full");
      setMe(data);
      setDraft({
        name: data.name, phone: data.phone || "",
        corporation: {
          name: data.corporation?.name || "",
          business_number: data.corporation?.business_number || "",
          address: data.corporation?.address || "",
        },
      });
    } catch (e) { setErr(fmtError(e)); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const updated = await api.patch("/users/me", draft);
      setMe(updated.data);
      setUser(updated.data);
      setEditing(false);
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const togglePref = async (group, key) => {
    if (!me) return;
    const next = { ...(me.notification_prefs || {}) };
    next[group] = { ...(next[group] || {}), [key]: !next[group]?.[key] };
    setMe({ ...me, notification_prefs: next });
    try { await api.patch("/users/me", { notification_prefs: next }); } catch (x) { setErr(fmtError(x)); }
  };

  const submitPw = async (e) => {
    e.preventDefault(); setPwErr("");
    if (pwForm.new_password !== pwForm.confirm) return setPwErr("Passwords do not match");
    if (pwForm.new_password.length < 8) return setPwErr("Use at least 8 characters");
    setPwBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: pwForm.current_password, new_password: pwForm.new_password });
      setPwDone(true);
      setPwForm({ current_password: "", new_password: "", confirm: "" });
    } catch (x) { setPwErr(fmtError(x)); }
    setPwBusy(false);
  };

  if (!me) {
    return <div className="page-narrow"><div className="card">Loading...</div></div>;
  }

  const prefs = me.notification_prefs || { email: {}, push: {} };

  const isClient = user?.role === "CLIENT";
  const content = (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="account-page">
      <h1 className="page-title">Account settings</h1>
      {err && <div className="alert alert-risk">{err}</div>}

      <AvatarUploadCard me={me} setMe={setMe} setUser={setUser} />

      {/* Account information */}
      <div className="card" data-testid="account-info-card">
        <div className="section-label" style={{ marginBottom: 16 }}>ACCOUNT INFORMATION</div>
        <div className="grid-2" style={{ rowGap: 18 }}>
          <InfoRow label="Name" value={editing ? draft.name : me.name} editing={editing} onChange={(v) => setDraft({ ...draft, name: v })} testid="info-name" />
          <InfoRow label="Email" value={me.email} editing={false} testid="info-email" />
          <InfoRow label="Phone" value={editing ? draft.phone : (me.phone || "—")} editing={editing} onChange={(v) => setDraft({ ...draft, phone: v })} testid="info-phone" />
          <InfoRow label="Corporation" value={editing ? draft.corporation.name : me.corporation?.name} editing={editing} onChange={(v) => setDraft({ ...draft, corporation: { ...draft.corporation, name: v } })} testid="info-corp" />
          <InfoRow label="Business No." value={editing ? draft.corporation.business_number : me.corporation?.business_number} editing={editing} onChange={(v) => setDraft({ ...draft, corporation: { ...draft.corporation, business_number: v } })} testid="info-bn" />
          <InfoRow label="Address" value={editing ? draft.corporation.address : me.corporation?.address} editing={editing} onChange={(v) => setDraft({ ...draft, corporation: { ...draft.corporation, address: v } })} testid="info-addr" />
        </div>
        <div className="flex gap-2 mt-4">
          {editing ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={busy} data-testid="info-save">Save</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(false); load(); }}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} data-testid="info-edit">Edit information</button>
          )}
        </div>
      </div>

      {/* Notification settings */}
      <div className="card" data-testid="notif-card">
        <div className="section-label" style={{ marginBottom: 16 }}>NOTIFICATION SETTINGS</div>
        <div className="section-label" style={{ marginBottom: 12, marginTop: 4 }}>EMAIL NOTIFICATIONS</div>
        <ToggleRow label="Return preparation updates" value={prefs.email?.return_updates} onChange={() => togglePref("email", "return_updates")} testid="pref-return-updates" />
        <ToggleRow label="Document reminders" value={prefs.email?.doc_reminders} onChange={() => togglePref("email", "doc_reminders")} testid="pref-doc-reminders" />
        <ToggleRow label="Important announcements" value={prefs.email?.announcements} onChange={() => togglePref("email", "announcements")} testid="pref-announcements" />
        <ToggleRow label="Monthly tax tips" value={prefs.email?.tax_tips} onChange={() => togglePref("email", "tax_tips")} testid="pref-tax-tips" />

        <div className="section-label" style={{ marginBottom: 12, marginTop: 20 }}>PUSH NOTIFICATIONS</div>
        <ToggleRow label="Document requests" value={prefs.push?.doc_requests} onChange={() => togglePref("push", "doc_requests")} testid="pref-doc-requests" />
        <ToggleRow label="CPA messages" value={prefs.push?.cpa_messages} onChange={() => togglePref("push", "cpa_messages")} testid="pref-cpa-messages" />
      </div>

      {/* Security & privacy */}
      <div className="card" data-testid="security-card">
        <div className="section-label" style={{ marginBottom: 16 }}>SECURITY & PRIVACY</div>
        <div className="list-row">
          <div className="flex items-center gap-3">
            <ShieldCheck size={16} style={{ color: "var(--text-secondary)" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Two-factor authentication</div>
              <div className="tertiary" style={{ fontSize: 11 }}>{me.two_factor_enabled ? "Enabled" : "Not enabled"}</div>
            </div>
          </div>
          <a className="btn-link" href="#" onClick={(e) => e.preventDefault()} data-testid="enable-2fa">{me.two_factor_enabled ? "Disable" : "Enable 2FA"}</a>
        </div>
        <div className="list-row">
          <div className="flex items-center gap-3">
            <KeyRound size={16} style={{ color: "var(--text-secondary)" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Password</div>
              <div className="tertiary" style={{ fontSize: 11 }}>Last changed —</div>
            </div>
          </div>
          <button className="btn-link" onClick={() => { setPwOpen(true); setPwDone(false); }} data-testid="change-password">Change password</button>
        </div>

        {pwOpen && (
          <div className="mt-4" style={{ background: "var(--bg-subtle)", padding: 16, borderRadius: 10 }}>
            {pwDone ? (
              <div className="flex items-center between">
                <div style={{ color: "var(--status-complete-text)", fontSize: 13 }}>Password updated successfully.</div>
                <button className="btn btn-secondary btn-sm" onClick={() => { setPwOpen(false); setPwDone(false); }}>Close</button>
              </div>
            ) : (
              <form onSubmit={submitPw} className="stack-md">
                <div className="field"><label className="field-label">Current password</label>
                  <input className="input" type="password" value={pwForm.current_password} onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })} required data-testid="pw-current" /></div>
                <div className="field"><label className="field-label">New password (min 8)</label>
                  <input className="input" type="password" value={pwForm.new_password} onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })} required data-testid="pw-new" /></div>
                <div className="field"><label className="field-label">Confirm new password</label>
                  <input className="input" type="password" value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} required data-testid="pw-confirm" /></div>
                {pwErr && <div className="alert alert-risk">{pwErr}</div>}
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={pwBusy} data-testid="pw-submit">{pwBusy ? <span className="spinner" /> : "Update password"}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPwOpen(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Help & support */}
      <div className="card" data-testid="help-card">
        <div className="section-label" style={{ marginBottom: 16 }}>HELP & SUPPORT</div>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          Have questions? Contact us at <a className="link-underline" style={{ color: "#1565c0" }} href="mailto:support@cloudtax.ca">support@cloudtax.ca</a> or call <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Phone size={12} /> 1-888-CloudTax</span>.
        </p>
        <div className="flex gap-2 mt-4">
          <button className="btn btn-secondary btn-sm" data-testid="view-faq"><BookOpen size={12} /> View FAQ ›</button>
          <button className="btn btn-secondary btn-sm" data-testid="download-guide"><Download size={12} /> Download guide</button>
        </div>
      </div>

      <button
        className="btn"
        style={{
          background: "#fff", color: "#c62828", border: "1px solid #f0d4d4", width: "fit-content",
          marginTop: 4,
        }}
        onClick={async () => { await logout(); navigate("/login"); }}
        data-testid="account-signout"
      >
        <LogOut size={14} /> Sign out
      </button>

      <div style={{ height: 40 }} />
    </div>
  );

  if (isClient) return content;
  return (
    <div className="app-root">
      <AppHeader />
      {content}
    </div>
  );
}
