import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtError, initials } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import UserAvatar from "../components/shared/UserAvatar";
import AppHeader from "../components/shared/AppHeader";
import AvatarUploadCard from "../components/shared/AvatarUploadCard";
import TwoFactorCard from "../components/shared/TwoFactorCard";
import PasswordField from "../components/shared/PasswordField";
import EmailAutocomplete from "../components/shared/EmailAutocomplete";
import { ArrowLeft, Plus, X, Download, Check, MoreVertical, Pencil, Trash2, Mail, AlertCircle } from "lucide-react";
const PERMISSION_COLUMNS = [
  { key: "view_clients", label: "VIEW CLIENTS", title: "View Clients" },
  { key: "onboard_clients", label: "ONBOARD CLIENTS", title: "Onboard Clients" },
  { key: "assign_cpa", label: "ASSIGN CPA", title: "Assign CPA" },
  { key: "reassign_cpa", label: "REASSIGN CPA", title: "Reassign CPA" },
  { key: "send_reminders", label: "SEND REMINDERS", title: "Send Reminders" },
  { key: "send_messages", label: "SEND MESSAGES", title: "Send Messages" },
  { key: "view_docs", label: "VIEW DOCS", title: "View Docs" },
  { key: "move_clients", label: "MOVE CLIENTS", title: "Move Clients" },
  { key: "workload", label: "WORKLOAD", title: "Workload" },
  { key: "view_cpa_hours", label: "VIEW CPA HOURS", title: "View CPA Hours" },
  { key: "export_data", label: "EXPORT DATA", title: "Export Data" },
  { key: "settings", label: "SETTINGS", title: "Settings" },
  { key: "audit_logs", label: "AUDIT LOGS", title: "Audit Logs" },
  { key: "manage_roles", label: "MANAGE ROLES", title: "Manage Roles" },
];

const DISPLAY_ROLES = ["Admin", "Manager", "Other", "CPA", "Partner"];

// Inline hint that appears under the email input when the admin picks an
// existing user from the typeahead. Describes what will happen next so the
// invite flow doesn't surprise them.
function ExistingUserHint({ row, targetRole, onResend, busy }) {
  if (!row) return null;
  const status = row.status || "active";
  const role = row.role;
  const label = row.name || row.email;
  let bg, border, fg, Icon, msg;
  // CLIENT → staff upgrade path (works regardless of lifecycle state, as
  // long as the admin picked a non-CLIENT target role). This is the
  // Admin-only "promote a client to staff" flow.
  if (role === "CLIENT" && status !== "removed" && targetRole && targetRole !== "CLIENT") {
    bg = "#e8f5e9"; border = "#a5d6a7"; fg = "#1b5e20"; Icon = Check;
    msg = `${label} is an existing client. Submit to upgrade this account to a team member — engagement history is preserved.`;
  } else if (status === "active") {
    bg = "#fdecea"; border = "#f9bdb9"; fg = "#b71c1c"; Icon = AlertCircle;
    msg = `${label} is already an active ${row.display_role || role || "member"}.`;
  } else if (status === "invited") {
    bg = "#fff8e1"; border = "#ffe082"; fg = "#8a6d1a"; Icon = Mail;
    msg = `${label} already has a pending invitation. You can resend it, or submit to issue a fresh one.`;
  } else {
    bg = "#e3f2fd"; border = "#90caf9"; fg = "#0d47a1"; Icon = Check;
    msg = `${label} was previously removed. Submit to reactivate with the selected role & permissions.`;
  }
  // "Blocking" = active non-CLIENT match; every other case allows submit.
  const isBlocking = status === "active" && role !== "CLIENT";
  return (
    <div
      data-testid={`existing-user-hint-${status}${role === "CLIENT" && status !== "removed" ? "-client" : ""}`}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        marginTop: 8, padding: "10px 12px",
        background: bg, border: `1px solid ${border}`, borderRadius: 8,
        fontSize: 12, lineHeight: 1.5, color: fg,
      }}
    >
      <Icon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>{msg}</div>
      {!isBlocking && status !== "active" && role !== "CLIENT" && (
        <button
          type="button"
          onClick={onResend}
          disabled={busy}
          data-testid="existing-user-resend"
          style={{
            padding: "4px 10px", borderRadius: 6, border: `1px solid ${fg}`,
            background: "#fff", color: fg, fontSize: 11, fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
          }}
        >{busy ? "Sending…" : "Resend invite"}</button>
      )}
    </div>
  );
}

function roleBadge(label) {
  const map = {
    Admin: { bg: "#fce4ec", fg: "#c2185b" },
    Manager: { bg: "#fff3e0", fg: "#ef6c00" },
    Other: { bg: "#eceff1", fg: "#546e7a" },
    CPA: { bg: "#ede7f6", fg: "#5e35b1" },
    Partner: { bg: "#e3f2fd", fg: "#1565c0" },
  };
  return map[label] || map.Other;
}

function Checkbox({ checked, onChange, disabled, testid }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      data-testid={testid}
      style={{
        width: 18, height: 18, borderRadius: 4,
        border: checked ? "1px solid #1565c0" : "1px solid #c5c0b8",
        background: checked ? "#1565c0" : "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 120ms ease",
      }}
    >
      {checked && <Check size={12} style={{ color: "#fff" }} strokeWidth={3} />}
    </button>
  );
}

function ProfileTab({ me, refresh, setUser }) {
  const [form, setForm] = useState({ name: me.name || "", email: me.email });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [pwErr, setPwErr] = useState("");

  const save = async () => {
    setBusy(true); setErr(""); setDone(false);
    try {
      await api.patch("/users/me", { name: form.name });
      setDone(true);
      await refresh();
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const submitPw = async (e) => {
    e.preventDefault(); setPwErr(""); setPwDone(false);
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

  return (
    <div className="stack-lg" data-testid="settings-profile-tab">
      <AvatarUploadCard
        me={me}
        onChange={async (next) => {
          setUser?.((u) => (u && typeof u === "object" ? { ...u, avatar_url: next.avatar_url } : u));
          await refresh();
        }}
      />

      <TwoFactorCard
        me={me}
        onChange={async (next) => {
          setUser?.((u) => (u && typeof u === "object" ? { ...u, two_factor_enabled: !!next.two_factor_enabled } : u));
          await refresh();
        }}
      />
      <div className="stack-md">
        <div className="field">
          <label className="field-label">NAME</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="profile-name" />
        </div>
        <div className="field">
          <label className="field-label">EMAIL</label>
          <input className="input" value={form.email} disabled data-testid="profile-email" />
        </div>
        {err && <div className="alert alert-risk">{err}</div>}
        {done && <div className="muted" style={{ color: "#2e7d32", fontSize: 13 }}>Saved.</div>}
        <button
          onClick={save} disabled={busy}
          style={{
            width: "fit-content", padding: "10px 24px", borderRadius: 8,
            background: "#1e88e5", color: "#fff", fontWeight: 500, fontSize: 14,
          }}
          data-testid="profile-save"
        >{busy ? "Saving…" : "Save changes"}</button>
      </div>

      <div style={{ height: 1, background: "var(--border-default)" }} />

      <div className="stack-md">
        <h3 style={{ fontSize: 16, fontWeight: 600 }}>Change password</h3>
        <form onSubmit={submitPw} className="stack-md">
          <div className="field">
            <label className="field-label">CURRENT PASSWORD</label>
            <PasswordField placeholder="Enter current password"
              value={pwForm.current_password}
              onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
              testid="pw-current" autoComplete="current-password" />
          </div>
          <div className="field">
            <label className="field-label">NEW PASSWORD</label>
            <PasswordField placeholder="Enter new password"
              value={pwForm.new_password}
              onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
              testid="pw-new" autoComplete="new-password" />
          </div>
          <div className="field">
            <label className="field-label">CONFIRM PASSWORD</label>
            <PasswordField placeholder="Confirm new password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
              testid="pw-confirm" autoComplete="new-password" />
          </div>
          {pwErr && <div className="alert alert-risk">{pwErr}</div>}
          {pwDone && <div className="muted" style={{ color: "#2e7d32", fontSize: 13 }}>Password updated.</div>}
          <button type="submit" disabled={pwBusy}
            style={{
              width: "fit-content", padding: "10px 24px", borderRadius: 8,
              background: "#1a1a1a", color: "#fff", fontWeight: 500, fontSize: 14,
            }}
            data-testid="pw-submit"
          >{pwBusy ? "Updating…" : "Update password"}</button>
        </form>
      </div>
    </div>
  );
}

function NotificationsTab({ me, refresh }) {
  const prefs = me.notification_prefs || { email: {}, push: {} };
  const toggle = async (group, key) => {
    const next = { ...prefs };
    next[group] = { ...(next[group] || {}), [key]: !next[group]?.[key] };
    try { await api.patch("/users/me", { notification_prefs: next }); await refresh(); } catch { /* */ }
  };
  const Row = ({ group, k, label }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--bg-subtle)", borderRadius: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <Checkbox checked={!!prefs[group]?.[k]} onChange={() => toggle(group, k)} testid={`pref-${group}-${k}`} />
    </div>
  );
  return (
    <div className="stack-lg" data-testid="settings-notifications-tab">
      <div>
        <div className="section-label" style={{ marginBottom: 12 }}>EMAIL NOTIFICATIONS</div>
        <Row group="email" k="return_updates" label="Return preparation updates" />
        <Row group="email" k="doc_reminders" label="Document reminders" />
        <Row group="email" k="announcements" label="Important announcements" />
        <Row group="email" k="tax_tips" label="Monthly tax tips" />
      </div>
      <div>
        <div className="section-label" style={{ marginBottom: 12 }}>PUSH NOTIFICATIONS</div>
        <Row group="push" k="doc_requests" label="Document requests" />
        <Row group="push" k="cpa_messages" label="CPA messages" />
      </div>
    </div>
  );
}

function DocumentsTab() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onExport = async () => {
    setBusy(true); setErr("");
    try {
      const resp = await api.get("/metrics/export", { responseType: "blob" });
      const cd = resp.headers["content-disposition"] || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m ? m[1] : `cloudtax-pilot-debrief-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };
  return (
    <div className="stack-lg" data-testid="settings-documents-tab">
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Pilot debrief export</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Download a CSV of all pilot engagements with metrics for executive review.</p>
        <button
          onClick={onExport} disabled={busy}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 8, background: "#1a1a1a", color: "#fff", fontSize: 13, fontWeight: 500 }}
          data-testid="export-csv"
        ><Download size={14} /> {busy ? "Exporting…" : "Export pilot debrief CSV"}</button>
        {err && <div className="alert alert-risk" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </div>
  );
}

function DisplayTab() {
  return (
    <div className="stack-lg" data-testid="settings-display-tab">
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Display preferences</h3>
        <p className="muted" style={{ fontSize: 13 }}>Theme, density and language preferences. Coming soon.</p>
      </div>
    </div>
  );
}

// Role -> canonical role + default permission preset. Picking a role in the
// dropdown auto-populates the checkbox grid with a sensible starting point
// (matches backend `default_permissions_for`). Admins can still toggle
// individual checkboxes after the preset is applied.
const ROLE_PRESETS = {
  Admin:   { canonical: "ADMIN",      perms: { view_clients: true, onboard_clients: true, assign_cpa: true, reassign_cpa: true, send_reminders: true, send_messages: true, view_docs: true, move_clients: true, workload: true, view_cpa_hours: true, export_data: true, settings: true, audit_logs: true, manage_roles: true } },
  Manager: { canonical: "ADMIN",      perms: { view_clients: true, onboard_clients: true, assign_cpa: true, reassign_cpa: true, send_reminders: true, send_messages: true, view_docs: true, move_clients: true, workload: true, view_cpa_hours: true, export_data: true, settings: false, audit_logs: true, manage_roles: false } },
  Other:   { canonical: "ADMIN",      perms: { view_clients: true, onboard_clients: false, assign_cpa: false, reassign_cpa: false, send_reminders: false, send_messages: false, view_docs: true, move_clients: false, workload: false, view_cpa_hours: false, export_data: false, settings: false, audit_logs: false, manage_roles: false } },
  CPA:     { canonical: "CPA",        perms: { view_clients: true, onboard_clients: false, assign_cpa: false, reassign_cpa: false, send_reminders: true, send_messages: true, view_docs: true, move_clients: false, workload: false, view_cpa_hours: true, export_data: false, settings: false, audit_logs: false, manage_roles: false } },
  Partner: { canonical: "PARTNER", perms: { view_clients: true, onboard_clients: false, assign_cpa: false, reassign_cpa: false, send_reminders: false, send_messages: false, view_docs: true, move_clients: false, workload: false, view_cpa_hours: false, export_data: false, settings: false, audit_logs: false, manage_roles: false } },
};

function AddMemberModal({ onClose, onDone }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    role: "CPA",
    permissions: { ...ROLE_PRESETS.CPA.perms },
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState(null);
  const [emailSent, setEmailSent] = useState(false);
  const [reactivated, setReactivated] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // When the admin selects an existing row from the typeahead, we remember
  // it so we can (a) short-circuit the submit with an appropriate message
  // for active members and (b) offer a Resend for invited/removed ones.
  const [existing, setExisting] = useState(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [upgraded, setUpgraded] = useState(false);

  const togglePerm = (k) => setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions[k] } }));
  const changeRole = (r) => {
    const preset = ROLE_PRESETS[r] || ROLE_PRESETS.CPA;
    setForm((f) => ({ ...f, role: r, permissions: { ...preset.perms } }));
  };
  const canonicalRole = useMemo(() => (ROLE_PRESETS[form.role]?.canonical) || "ADMIN", [form.role]);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const { data } = await api.post("/users/invite", {
        email: form.email,
        name: `${form.first_name} ${form.last_name}`.trim(),
        role: canonicalRole,
        display_role: form.role,
        permissions: form.permissions,
      });
      setLink(data.invite_link);
      setEmailSent(!!data.email_sent);
      setReactivated(!!data.reactivated);
      setUpgraded(!!data.upgraded);
      await onDone();
    } catch (e) {
      const status = e?.response?.status;
      if (status === 403) {
        setErr("Your admin session has expired or your permissions have changed. Please sign out and sign back in to continue.");
      } else {
        setErr(fmtError(e));
      }
    }
    setBusy(false);
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback — some sandboxed iframes block the API.
      const ta = document.createElement("textarea");
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } finally { document.body.removeChild(ta); }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="add-member-modal">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Add member</h2>
          <button onClick={onClose} data-testid="add-member-close"><X size={18} /></button>
        </div>
        {link ? (
          <div className="stack-md">
            {upgraded && (
              <div
                data-testid="invite-upgraded"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 14px", background: "#e8f5e9",
                  border: "1px solid #a5d6a7", borderRadius: 10,
                }}
              >
                <Check size={16} style={{ color: "#1b5e20", flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0d2914" }}>
                  <strong>Client upgraded to team member.</strong> Their engagement history is preserved and the new role &amp; permissions are active immediately.
                </div>
              </div>
            )}
            {reactivated && (
              <div
                data-testid="invite-reactivated"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 14px", background: "#e3f2fd",
                  border: "1px solid #90caf9", borderRadius: 10,
                }}
              >
                <Check size={16} style={{ color: "#0d47a1", flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0d2b4e" }}>
                  <strong>Previously removed member reactivated.</strong> Their account has been restored with the new role &amp; permissions. A fresh invitation has been issued.
                </div>
              </div>
            )}
            {emailSent ? (
              <div
                data-testid="invite-email-sent"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 14px", background: "#e8f5e9",
                  border: "1px solid #c8e6c9", borderRadius: 10,
                }}
              >
                <Check size={16} style={{ color: "#1b5e20", flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0d2914" }}>
                  <strong>Invitation email sent</strong> to <code style={{ background: "transparent" }}>{form.email}</code>. They&rsquo;ll receive a CloudTax welcome email with a secure link to set their password.
                </div>
              </div>
            ) : (
              <div
                data-testid="invite-email-fallback"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "12px 14px", background: "#fff3e0",
                  border: "1px solid #ffcc80", borderRadius: 10,
                }}
              >
                <Mail size={16} style={{ color: "#e65100", flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#2c1810" }}>
                  <strong>Email not delivered.</strong> Share the link below manually with the new member so they can set their password.
                </div>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12 }}>Invitation link (also included in the email):</div>
            <div style={{ position: "relative" }}>
              <code style={{ display: "block", padding: "12px 72px 12px 12px", background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all", border: "1px solid var(--border-default)" }} data-testid="invite-link">{link}</code>
              <button
                onClick={copyLink}
                data-testid="invite-link-copy"
                style={{
                  position: "absolute", top: 6, right: 6,
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 6,
                  background: linkCopied ? "#e8f5e9" : "#fff",
                  border: `1px solid ${linkCopied ? "#a5d6a7" : "var(--border-default)"}`,
                  color: linkCopied ? "#1b5e20" : "var(--text-primary)",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}
              >
                {linkCopied ? <><Check size={12} /> Copied</> : <><Download size={12} style={{ transform: "rotate(0deg)" }} /> Copy</>}
              </button>
            </div>
            <button onClick={onClose} className="btn btn-primary" style={{ width: "100%", padding: "12px" }} data-testid="add-member-done">Done</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Personal information</div>
            <div className="stack-md">
              <div className="field">
                <label className="field-label">FIRST NAME</label>
                <input className="input" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="add-first-name" />
              </div>
              <div className="field">
                <label className="field-label">LAST NAME</label>
                <input className="input" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="add-last-name" />
              </div>
              <div className="field">
                <label className="field-label">EMAIL</label>
                <EmailAutocomplete
                  value={form.email}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, email: v }));
                    // Typing clears the pinned selection so the admin can
                    // invite a brand-new address by simply typing past the
                    // previously-selected row.
                    setExisting(null);
                  }}
                  onSelect={(row) => {
                    setExisting(row);
                    // If the admin hasn't filled name yet and the existing
                    // row has one, pre-populate so the form isn't empty.
                    // Prefer the verbatim first_name/last_name so multi-word
                    // values like "Dr Bala" survive the round-trip. Fall back
                    // to a single split of ``name`` only for legacy rows.
                    if (!form.first_name && !form.last_name) {
                      if (row?.first_name != null || row?.last_name != null) {
                        setForm((f) => ({
                          ...f,
                          first_name: row.first_name || "",
                          last_name: row.last_name || "",
                        }));
                      } else if (row?.name) {
                        const raw = row.name.trim();
                        const idx = raw.indexOf(" ");
                        setForm((f) => ({
                          ...f,
                          first_name: idx === -1 ? raw : raw.slice(0, idx),
                          last_name: idx === -1 ? "" : raw.slice(idx + 1),
                        }));
                      }
                    }
                  }}
                  testid="add-email"
                />
                {existing && <ExistingUserHint row={existing} targetRole={canonicalRole} onResend={async () => {
                  setErr(""); setResendBusy(true);
                  try {
                    const { data } = await api.post(`/users/${existing.id}/resend-invite`);
                    setLink(data.invite_link);
                    setEmailSent(!!data.email_sent);
                    await onDone();
                  } catch (e) {
                    const status = e?.response?.status;
                    setErr(status === 403
                      ? "Your admin session has expired. Please sign out and sign back in."
                      : fmtError(e));
                  }
                  setResendBusy(false);
                }} busy={resendBusy} />}
              </div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, margin: "20px 0 8px" }}>Choose role</div>
            <select className="select" value={form.role} onChange={(e) => changeRole(e.target.value)} data-testid="add-role">
              {DISPLAY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Permissions below are the <strong>default set</strong> for this role. You can fine-tune them.</div>

            <div style={{ fontSize: 14, fontWeight: 600, margin: "20px 0 8px" }}>Permissions</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
              {PERMISSION_COLUMNS.map((p) => (
                <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <Checkbox checked={form.permissions[p.key]} onChange={() => togglePerm(p.key)} testid={`add-perm-${p.key}`} />
                  <span>{p.title}</span>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 24, padding: 16, borderLeft: "3px solid #1e88e5", background: "var(--bg-subtle)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>What happens next</div>
              <ol style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: 18 }}>
                <li>An invitation email will be sent to the new member.</li>
                <li>They will be prompted to set up their account.</li>
                <li>Once activated, they will appear in the team list with the selected permissions.</li>
              </ol>
            </div>

            {err && <div className="alert alert-risk" style={{ marginTop: 12 }} data-testid="add-member-err">{err}</div>}

            <button
              onClick={submit}
              disabled={busy || !form.email || !form.first_name || (existing?.status === "active" && existing?.role !== "CLIENT")}
              style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#1e88e5", color: "#fff", fontWeight: 500, fontSize: 14, marginTop: 20, border: "none", cursor: busy ? "not-allowed" : "pointer" }}
              data-testid="add-member-submit"
            >{
              busy ? "Adding…"
              : (existing?.status === "active" && existing?.role === "CLIENT") ? "Upgrade to team member"
              : (existing?.status === "active") ? "Already a member"
              : (existing?.status === "removed") ? "Reactivate & invite"
              : "Add member"
            }</button>
            <button onClick={onClose} style={{ width: "100%", padding: "12px", borderRadius: 8, background: "var(--bg-subtle)", fontSize: 13, marginTop: 8, border: "1px solid var(--border-default)", cursor: "pointer" }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function RolesTab() {
  const [team, setTeam] = useState([]);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);     // user object being edited
  const [confirmRemove, setConfirmRemove] = useState(null);  // user pending removal
  const [openMenu, setOpenMenu] = useState(null);   // uid with actions menu open
  // When the menu is rendered as a fixed-position overlay we need to know
  // where to anchor it. Stored as {top, right} relative to the viewport.
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [resendResult, setResendResult] = useState(null);
  const [resendBusy, setResendBusy] = useState(null);     // uid being resent

  const load = async () => {
    try { const { data } = await api.get("/users/team"); setTeam(data); } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  // Close the actions menu on any outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (!e.target.closest || !e.target.closest("[data-testid^='role-actions-']")) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Close the menu on scroll/resize — otherwise the fixed-position anchor
  // would drift away from the trigger button as the table scrolls.
  useEffect(() => {
    if (!openMenu) return;
    const onMove = () => setOpenMenu(null);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [openMenu]);

  const toggleMenu = (uid, triggerEl) => {
    if (openMenu === uid) { setOpenMenu(null); return; }
    const rect = triggerEl.getBoundingClientRect();
    // Anchor the menu 4px below the button, right-aligned to the button.
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenu(uid);
  };

  const updatePerm = async (uid, key, value) => {
    const u = team.find((x) => x.id === uid);
    if (!u) return;
    const next = { ...u.permissions, [key]: value };
    setTeam(team.map((x) => x.id === uid ? { ...x, permissions: next } : x));
    try { await api.patch(`/users/${uid}`, { permissions: next }); } catch { load(); }
  };

  const updateDisplayRole = async (uid, dr) => {
    setTeam(team.map((x) => x.id === uid ? { ...x, display_role: dr } : x));
    try { await api.patch(`/users/${uid}`, { display_role: dr }); } catch { load(); }
  };

  const doRemove = async () => {
    if (!confirmRemove) return;
    setErr("");
    try {
      await api.delete(`/users/${confirmRemove.id}`);
      setConfirmRemove(null);
      await load();
    } catch (x) {
      setErr(fmtError(x));
    }
  };

  const doResendInvite = async (u) => {
    setOpenMenu(null);
    setErr("");
    setResendBusy(u.id);
    try {
      const { data } = await api.post(`/users/${u.id}/resend-invite`);
      setResendResult({ user: u, link: data.invite_link, emailSent: !!data.email_sent });
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setResendBusy(null);
    }
  };

  return (
    <div data-testid="settings-roles-tab">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Roles & Permissions</h3>
          <p className="muted" style={{ fontSize: 13 }}>Admin role has full access to all features</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="btn btn-primary"
          data-testid="add-member-open"
        ><Plus size={14} /> Add member</button>
      </div>
      {err && <div className="alert alert-risk">{err}</div>}
      <div style={{ overflowX: "auto", border: "1px solid var(--border-default)", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }} data-testid="roles-table">
          <thead>
            <tr style={{ background: "var(--bg-subtle)" }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>MEMBER</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>ROLE</th>
              {PERMISSION_COLUMNS.map((p) => (
                <th key={p.key} style={{ padding: "12px 8px", textAlign: "center", fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5, fontSize: 10, lineHeight: 1.2, minWidth: 60 }}>
                  {p.label.split(" ").map((w, i) => <div key={i}>{w}</div>)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((u) => {
              const dr = u.display_role || "Other";
              const isAdmin = dr === "Admin";
              const rb = roleBadge(dr);
              return (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border-default)" }} data-testid={`role-row-${u.id}`}>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <UserAvatar user={u} size={32} testid={`role-avatar-${u.id}`} />
                      <span style={{ fontSize: 13 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <select
                      value={dr}
                      onChange={(e) => updateDisplayRole(u.id, e.target.value)}
                      data-testid={`role-select-${u.id}`}
                      style={{
                        padding: "4px 22px 4px 10px",
                        borderRadius: 999,
                        background: rb.bg,
                        color: rb.fg,
                        fontSize: 12,
                        fontWeight: 500,
                        border: "none",
                        appearance: "none",
                        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23666' d='M5 7L1 3h8z'/%3E%3C/svg%3E\")",
                        backgroundRepeat: "no-repeat",
                        backgroundPosition: "right 6px center",
                      }}
                    >
                      {DISPLAY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  {PERMISSION_COLUMNS.map((p) => (
                    <td key={p.key} style={{ padding: "14px 8px", textAlign: "center" }}>
                      {isAdmin ? (
                        <span style={{ color: "#2e7d32", fontWeight: 700 }}>✓</span>
                      ) : (
                        <Checkbox
                          checked={!!u.permissions?.[p.key]}
                          onChange={(v) => updatePerm(u.id, p.key, v)}
                          testid={`perm-${u.id}-${p.key}`}
                        />
                      )}
                    </td>
                  ))}
                  {/* Three-dot actions menu */}
                  <td style={{ padding: "14px 8px", textAlign: "center", position: "relative" }} data-testid={`role-actions-${u.id}`}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMenu(u.id, e.currentTarget); }}
                      data-testid={`role-actions-trigger-${u.id}`}
                      aria-label={`Actions for ${u.name}`}
                      style={{
                        width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
                        color: "var(--text-secondary)", cursor: "pointer", display: "inline-flex",
                        alignItems: "center", justifyContent: "center",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {openMenu === u.id && menuAnchor && (
                      <div
                        data-testid={`role-actions-menu-${u.id}`}
                        role="menu"
                        style={{
                          position: "fixed",
                          top: menuAnchor.top,
                          right: menuAnchor.right,
                          background: "#fff", border: "1px solid var(--border-default)",
                          borderRadius: 10, boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                          zIndex: 1000, minWidth: 200, padding: 4, textAlign: "left",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => { setEditing(u); setOpenMenu(null); }}
                          data-testid={`role-actions-edit-${u.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "9px 12px", borderRadius: 6,
                            background: "transparent", border: "none", cursor: "pointer", fontSize: 13,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        ><Pencil size={14} /> Edit member</button>
                        <button
                          type="button"
                          onClick={() => doResendInvite(u)}
                          disabled={resendBusy === u.id}
                          data-testid={`role-actions-resend-${u.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "9px 12px", borderRadius: 6,
                            background: "transparent", border: "none",
                            cursor: resendBusy === u.id ? "wait" : "pointer", fontSize: 13,
                            color: "var(--text-primary)",
                          }}
                          onMouseEnter={(e) => { if (resendBusy !== u.id) e.currentTarget.style.background = "var(--bg-subtle)"; }}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        ><Mail size={14} /> {resendBusy === u.id ? "Sending…" : "Resend invitation"}</button>
                        <button
                          type="button"
                          onClick={() => { setConfirmRemove(u); setOpenMenu(null); }}
                          data-testid={`role-actions-remove-${u.id}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "9px 12px", borderRadius: 6,
                            background: "transparent", border: "none", cursor: "pointer", fontSize: 13,
                            color: "#c62828",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#ffebee"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        ><Trash2 size={14} /> Remove member</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onDone={load} />}
      {editing && <EditMemberModal user={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {resendResult && (
        <ResendResultModal
          result={resendResult}
          onClose={() => setResendResult(null)}
        />
      )}
      {confirmRemove && (
        <div className="modal-overlay" onClick={() => setConfirmRemove(null)} data-testid="remove-member-modal">
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>Remove {confirmRemove.name}?</h3>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 6 }}>
              <strong>{confirmRemove.name}</strong> (<code>{confirmRemove.email}</code>) will lose access immediately. Any engagements they&apos;re assigned to will keep the history — you can reassign them from the engagement page.
            </p>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>The email address will be freed so you can re-invite a different person to it later.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRemove(null)} data-testid="remove-member-cancel">Cancel</button>
              <button
                onClick={doRemove}
                data-testid="remove-member-confirm"
                style={{ padding: "8px 16px", borderRadius: 8, background: "#c62828", color: "#fff", fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer" }}
              >Remove member</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Resend-invitation result modal — shown after the admin clicks the
 * "Resend invitation" menu item. Surfaces the fresh link + copy button +
 * email-delivery status, mirroring the Add-Member success view.
 */
function ResendResultModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!result.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = result.link; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); } finally { document.body.removeChild(ta); }
    }
  };
  return (
    <div className="modal-overlay" onClick={onClose} data-testid="resend-result-modal">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Invitation resent</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="stack-md">
          {result.emailSent ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#e8f5e9", border: "1px solid #c8e6c9", borderRadius: 10 }}>
              <Check size={16} style={{ color: "#1b5e20", flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0d2914" }}>
                <strong>New invitation email sent</strong> to <code style={{ background: "transparent" }}>{result.user.email}</code>. Their previous link has been revoked.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: "#fff3e0", border: "1px solid #ffcc80", borderRadius: 10 }}>
              <Mail size={16} style={{ color: "#e65100", flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "#2c1810" }}>
                <strong>Email not delivered.</strong> Share the fresh link below manually — the previous link has been revoked either way.
              </div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12 }}>Fresh invitation link (also included in the email):</div>
          <div style={{ position: "relative" }}>
            <code style={{ display: "block", padding: "12px 72px 12px 12px", background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all", border: "1px solid var(--border-default)" }} data-testid="resend-link">{result.link}</code>
            <button
              onClick={copy}
              data-testid="resend-link-copy"
              style={{
                position: "absolute", top: 6, right: 6,
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "6px 12px", borderRadius: 6,
                background: copied ? "#e8f5e9" : "#fff",
                border: `1px solid ${copied ? "#a5d6a7" : "var(--border-default)"}`,
                color: copied ? "#1b5e20" : "var(--text-primary)",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
              }}
            >{copied ? <><Check size={12} /> Copied</> : <><Download size={12} /> Copy</>}</button>
          </div>
          <button onClick={onClose} className="btn btn-primary" style={{ width: "100%", padding: "12px" }} data-testid="resend-result-close">Done</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Edit-member modal — update display name and sign-in email. Emits an in-app
 * notification to the affected user when their email changes (admin action).
 * Role changes are NOT edited here; we keep role transitions as an explicit
 * "recreate via invite" operation to avoid accidental privilege changes.
 */
function EditMemberModal({ user, onClose, onDone }) {
  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const emailChanged = (email.trim().toLowerCase() !== (user.email || "").toLowerCase());
  const nameChanged = name.trim() !== (user.name || "").trim();
  const canSave = !busy && name.trim() && email.trim() && (emailChanged || nameChanged);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const payload = {};
      if (nameChanged) payload.name = name.trim();
      if (emailChanged) payload.email = email.trim();
      await api.patch(`/users/${user.id}`, payload);
      onDone();
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="edit-member-modal">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="flex items-center between" style={{ marginBottom: 18 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Edit {user.display_role || user.role} member</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="stack-md">
          <div className="field">
            <label className="field-label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-member-name" />
          </div>
          <div className="field">
            <label className="field-label">Sign-in email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="edit-member-email" />
            {emailChanged && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6, display: "flex", alignItems: "flex-start", gap: 6 }}>
                <Mail size={12} style={{ marginTop: 2 }} />
                <span>The member will receive an in-app notification that their sign-in email changed. Their current session stays active; they must use the new address next time they sign out.</span>
              </div>
            )}
          </div>
          {err && <div className="alert alert-risk" data-testid="edit-member-err">{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!canSave}
              onClick={submit}
              data-testid="edit-member-save"
            >{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const TIER_OPTIONS = [
  { key: "STANDARD", label: "Standard" },
  { key: "BOOKS_COMPLETE", label: "Books Complete" },
  { key: "WHITE_GLOVE", label: "White-Glove" },
];

const CATEGORY_TAGS = ["Income", "Expenses", "Banking", "Compliance", "Other"];
const TAG_COLORS = {
  Income: { bg: "#e8f5e9", fg: "#2e7d32" },
  Expenses: { bg: "#fff3e0", fg: "#ef6c00" },
  Banking: { bg: "#e3f2fd", fg: "#1565c0" },
  Compliance: { bg: "#ede7f6", fg: "#5e35b1" },
  Other: { bg: "#eceff1", fg: "#546e7a" },
};

function DocTemplatesTab() {
  const [tier, setTier] = useState("STANDARD");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "", tag: "Compliance", is_required: true });

  const load = async () => {
    setErr("");
    try {
      const { data } = await api.get(`/admin/document-templates/${tier}`);
      setItems(data.items || []);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tier]);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api.put(`/admin/document-templates/${tier}`, { items });
      setSavedAt(new Date());
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const updateItem = (i, patch) => setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const moveItem = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; setItems(next);
  };
  const addItem = () => {
    const name = draft.name.trim();
    if (!name) return;
    setItems([...items, { ...draft, name, description: draft.description.trim(), category: `CUSTOM_${Date.now()}` }]);
    setDraft({ name: "", description: "", tag: "Compliance", is_required: true });
  };

  return (
    <div data-testid="settings-doc-templates-tab">
      <div className="stack-md">
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Document templates</h3>
          <p className="muted" style={{ fontSize: 13 }}>Configure the documents requested for each service tier. Changes apply only to <strong>new</strong> engagements.</p>
        </div>

        {/* Sub-tabs per tier */}
        <div style={{ display: "flex", gap: 8 }} data-testid="tier-tabs">
          {TIER_OPTIONS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTier(t.key)}
              data-testid={`tier-tab-${t.key}`}
              style={{
                padding: "8px 18px", borderRadius: 999, fontSize: 13,
                fontWeight: tier === t.key ? 600 : 500,
                background: tier === t.key ? "#1565c0" : "var(--bg-subtle)",
                color: tier === t.key ? "#fff" : "var(--text-primary)",
                border: "1px solid " + (tier === t.key ? "#1565c0" : "var(--border-default)"),
              }}
            >{t.label}</button>
          ))}
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        {/* Items list */}
        <div style={{ border: "1px solid var(--border-default)", borderRadius: 12, overflow: "hidden" }} data-testid="template-items">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px 90px 60px", padding: "10px 16px", background: "var(--bg-subtle)", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5, gap: 12 }}>
            <span>NAME</span><span>DESCRIPTION</span><span>CATEGORY</span><span>REQUIRED</span><span></span>
          </div>
          {items.map((it, i) => {
            const tagColor = TAG_COLORS[it.tag] || TAG_COLORS.Other;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px 90px 60px", padding: "12px 16px", borderTop: "1px solid var(--border-default)", gap: 12, alignItems: "center" }} data-testid={`tmpl-row-${i}`}>
                <input
                  className="input" value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })}
                  data-testid={`tmpl-name-${i}`}
                  style={{ padding: "6px 8px", fontSize: 13 }}
                />
                <input
                  className="input" value={it.description || ""} onChange={(e) => updateItem(i, { description: e.target.value })}
                  data-testid={`tmpl-desc-${i}`}
                  style={{ padding: "6px 8px", fontSize: 13 }}
                />
                <select
                  className="select" value={it.tag || "Other"} onChange={(e) => updateItem(i, { tag: e.target.value })}
                  data-testid={`tmpl-tag-${i}`}
                  style={{ padding: "6px 8px", fontSize: 12, background: tagColor.bg, color: tagColor.fg, border: "1px solid " + tagColor.fg, borderRadius: 999, fontWeight: 500 }}
                >
                  {CATEGORY_TAGS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", justifyContent: "center" }}>
                  <input
                    type="checkbox" checked={!!it.is_required} onChange={(e) => updateItem(i, { is_required: e.target.checked })}
                    data-testid={`tmpl-req-${i}`}
                    style={{ width: 16, height: 16, accentColor: "#1565c0" }}
                  />
                </label>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button onClick={() => moveItem(i, -1)} disabled={i === 0} data-testid={`tmpl-up-${i}`} style={{ color: "var(--text-tertiary)", padding: 4 }}>↑</button>
                  <button onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} data-testid={`tmpl-down-${i}`} style={{ color: "var(--text-tertiary)", padding: 4 }}>↓</button>
                  <button onClick={() => removeItem(i)} data-testid={`tmpl-remove-${i}`} style={{ color: "#c62828", padding: 4 }}><X size={14} /></button>
                </div>
              </div>
            );
          })}
          {items.length === 0 && <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>No items. Add some below.</div>}
        </div>

        {/* Add new row */}
        <div style={{ border: "1px dashed var(--border-default)", borderRadius: 12, padding: 16 }} data-testid="add-item-row">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add new document item</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px 90px 90px", gap: 10, alignItems: "center" }}>
            <input className="input" placeholder="Document name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="new-item-name" style={{ padding: "8px 10px", fontSize: 13 }} />
            <input className="input" placeholder="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} data-testid="new-item-desc" style={{ padding: "8px 10px", fontSize: 13 }} />
            <select className="select" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} data-testid="new-item-tag" style={{ padding: "8px 10px", fontSize: 12 }}>
              {CATEGORY_TAGS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", justifyContent: "center" }}>
              <input type="checkbox" checked={draft.is_required} onChange={(e) => setDraft({ ...draft, is_required: e.target.checked })} data-testid="new-item-req" style={{ width: 16, height: 16, accentColor: "#1565c0" }} /> Required
            </label>
            <button onClick={addItem} disabled={!draft.name.trim()} data-testid="new-item-add" style={{ padding: "8px 14px", borderRadius: 8, background: draft.name.trim() ? "#1565c0" : "#bbdefb", color: "#fff", fontSize: 13, fontWeight: 500 }}>+ Add</button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>{items.length} items in <strong>{TIER_OPTIONS.find((t) => t.key === tier)?.label}</strong> template</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {savedAt && <span style={{ fontSize: 12, color: "#2e7d32" }}>Saved {savedAt.toLocaleTimeString()}</span>}
            <button onClick={save} disabled={busy} data-testid="tmpl-save" className="btn btn-primary">{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 14, borderLeft: "3px solid #1e88e5", background: "var(--bg-subtle)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>How this works</div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
            When a new client is added in this tier, this document list is what they will see in their portal. Existing engagements are unaffected. You can override the template anytime — the next engagement created will pick up your changes.
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "notifications", label: "Notifications" },
  { key: "documents", label: "Documents" },
  { key: "doc-templates", label: "Document templates" },
  { key: "display", label: "Display" },
  { key: "roles", label: "Roles & Permissions" },
  { key: "system", label: "System" },
];

function SystemTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try { const { data } = await api.get("/admin/config-health"); setData(data); }
      catch (e) { setErr(fmtError(e)); }
    })();
  }, []);
  if (err) return <div className="card alert-risk" data-testid="system-tab-err">{err}</div>;
  if (!data) return <div className="card">Loading system status…</div>;
  const leak = data.frontend_url_vendor_leak;
  const ok = !leak && data.production_mode && !data.show_dev_fallback_tokens && data.resend_configured;
  const row = (label, value, good) => (
    <div className="flex items-center" style={{ justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: good === undefined ? undefined : "var(--font-mono, monospace)", color: good === false ? "#a10f0f" : good === true ? "#1b5e20" : "var(--text-primary)", fontWeight: good === undefined ? 400 : 500 }}>
        {String(value ?? "—")}
      </span>
    </div>
  );
  return (
    <div className="stack-md" data-testid="system-tab">
      <div className="card" style={{ background: ok ? "#e8f5e9" : leak ? "#ffebee" : "#fff8e1", borderColor: ok ? "#c8e6c9" : leak ? "#ffcdd2" : "#ffecb3" }} data-testid="system-tab-banner">
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: ok ? "#1b5e20" : leak ? "#a10f0f" : "#6d4c00" }}>
          {ok ? "Production-ready configuration" : leak ? `URL misconfiguration — "${leak}" detected in FRONTEND_URL` : "Preview / non-production mode"}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: ok ? "#2e7d32" : leak ? "#7a1a1a" : "#6d4c00" }}>
          {leak
            ? <>Invitation and password-reset emails will contain URLs pointing at <code>{data.frontend_url}</code>. Set <code>FRONTEND_URL</code> to your customer-facing domain (e.g. <code>https://ws.cloudtax.ca</code>) and <code>PRODUCTION=true</code> in the deploy env, then redeploy.</>
            : ok
              ? <>All outbound emails will use <code>{data.frontend_url}</code>. Resend is configured. Debug fallbacks are disabled.</>
              : <>This stack is not flagged as production. Outbound emails will still use <code>{data.frontend_url}</code>, but safety checks are relaxed — expected on preview / dev environments.</>}
        </div>
      </div>
      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Runtime configuration</h2>
        {row("Customer-facing URL", data.frontend_url, leak ? false : true)}
        {row("Vendor-host leak", leak || "none", leak ? false : true)}
        {row("Production mode", data.production_mode ? "enabled" : "disabled", data.production_mode)}
        {row("Dev fallback tokens", data.show_dev_fallback_tokens ? "EXPOSED (disable in prod!)" : "hidden", !data.show_dev_fallback_tokens)}
        {row("Resend email delivery", data.resend_configured ? `configured (${data.resend_from || "no from"})` : "NOT configured", data.resend_configured)}
        {row("S3 region", data.s3_region)}
        {row("S3 bucket", data.s3_bucket)}
        {row("CORS origins", (data.cors_allow_origins || []).join(", "))}
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
        This page shows exactly what the backend will use when generating invitation links, password-reset emails, and CORS responses. Share this with the deploy operator when debugging URL or email delivery issues.
      </p>
      <LaunchCleanupCard />
    </div>
  );
}

function LaunchCleanupCard() {
  // One-shot cleanup before going live. Confirmation string must be typed
  // verbatim — guards against accidental clicks. Surfaces wipe counts so
  // the operator can audit exactly what was deleted.
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [wipeS3, setWipeS3] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const phrase = "WIPE EVERYTHING EXCEPT ADMINS";

  const run = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const { data } = await api.post("/admin/prepare-for-launch", {
        confirmation: confirm,
        enforce_2fa_on_admins: true,
        wipe_s3_objects: wipeS3,
      });
      setResult(data);
    } catch (e) { setErr(fmtError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ borderColor: "#ffcdd2", background: "#fff7f7" }} data-testid="launch-cleanup-card">
      <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: "#a10f0f" }}>Danger zone — prepare for launch</h2>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
        Wipes every user that is not an admin and ALL of their data — engagements, documents, messages, delegates, notifications, OTPs, sessions, login history. Also forces 2FA on all admins. This action cannot be undone.
      </p>
      {!open && !result && (
        <button
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 12, color: "#a10f0f", borderColor: "#ffcdd2" }}
          onClick={() => setOpen(true)}
          data-testid="launch-cleanup-open"
        >Wipe demo data &amp; go live…</button>
      )}
      {open && !result && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label className="field-label">Type <code>{phrase}</code> to confirm</label>
            <input
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoFocus
              data-testid="launch-cleanup-confirm-input"
            />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, marginTop: 8 }}>
            <input type="checkbox" checked={wipeS3} onChange={(e) => setWipeS3(e.target.checked)} data-testid="launch-cleanup-wipe-s3" />
            Also delete every object in the configured S3 bucket
          </label>
          {err && <div className="alert alert-risk" style={{ marginTop: 10, fontSize: 12 }}>{err}</div>}
          <div className="flex gap-2" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary btn-sm"
              style={{ background: "#a10f0f", borderColor: "#a10f0f" }}
              disabled={busy || confirm !== phrase}
              onClick={run}
              data-testid="launch-cleanup-execute"
            >{busy ? <span className="spinner" /> : "Execute wipe"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); setConfirm(""); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {result && (
        <div style={{ marginTop: 12, background: "#e8f5e9", border: "1px solid #c8e6c9", padding: 12, borderRadius: 10, fontSize: 12, lineHeight: 1.55 }} data-testid="launch-cleanup-result">
          <div style={{ fontWeight: 600, color: "#1b5e20", marginBottom: 6 }}>Cleanup complete</div>
          <div><strong>Executed by:</strong> {result.executed_by}</div>
          <div><strong>Survivors:</strong> {(result.survivors || []).join(", ")}</div>
          <div style={{ marginTop: 6 }}><strong>Wiped:</strong></div>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {Object.entries(result.wiped || {}).map(([k, v]) => (
              <li key={k}><code>{k}</code>: {v}</li>
            ))}
          </ul>
          {result.s3_wipe && <div style={{ marginTop: 6 }}><strong>S3 wipe:</strong> <code>{JSON.stringify(result.s3_wipe)}</code></div>}
        </div>
      )}
    </div>
  );
}

export default function AdminSettings() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "profile";
  const [me, setMe] = useState(user);

  const refresh = async () => {
    try { const { data } = await api.get("/users/me/full"); setMe(data); setUser(data); } catch { /* */ }
  };
  useEffect(() => { refresh(); }, []);

  const setTab = (k) => setParams({ tab: k });

  if (!me) return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide" style={{ paddingTop: 32 }}><div className="card">Loading…</div></div>
    </div>
  );

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg" style={{ paddingTop: 24, maxWidth: 1100 }}>
        <Link to="/admin/dashboard" className="btn-link" style={{ width: "fit-content" }} data-testid="back-to-portal">
          <ArrowLeft size={12} /> Back to dashboard
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginTop: 8 }}>Settings</h1>

        <div data-testid="settings-tabs" style={{ display: "flex", gap: 28, borderBottom: "1px solid var(--border-default)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`tab-${t.key}`}
              style={{
                padding: "10px 4px",
                fontSize: 14,
                fontWeight: tab === t.key ? 600 : 500,
                color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid #1565c0" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        <div style={{ paddingTop: 8 }}>
          {tab === "profile" && <ProfileTab me={me} refresh={refresh} setUser={setUser} />}
          {tab === "notifications" && <NotificationsTab me={me} refresh={refresh} />}
          {tab === "documents" && <DocumentsTab />}
          {tab === "doc-templates" && <DocTemplatesTab />}
          {tab === "display" && <DisplayTab />}
          {tab === "roles" && <RolesTab />}
          {tab === "system" && <SystemTab />}
        </div>

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}
