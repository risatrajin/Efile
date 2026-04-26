import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtError, initials } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppHeader from "../components/shared/AppHeader";
import { ArrowLeft, Plus, X, Download, Check } from "lucide-react";
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

function ProfileTab({ me, refresh }) {
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
            <input type="password" className="input" placeholder="Enter current password"
              value={pwForm.current_password}
              onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
              data-testid="pw-current" required />
          </div>
          <div className="field">
            <label className="field-label">NEW PASSWORD</label>
            <input type="password" className="input" placeholder="Enter new password"
              value={pwForm.new_password}
              onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
              data-testid="pw-new" required />
          </div>
          <div className="field">
            <label className="field-label">CONFIRM PASSWORD</label>
            <input type="password" className="input" placeholder="Confirm new password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
              data-testid="pw-confirm" required />
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

function AddMemberModal({ onClose, onDone }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "",
    role: "CPA",
    permissions: {
      view_clients: true, onboard_clients: false, assign_cpa: false, reassign_cpa: false,
      send_reminders: true, send_messages: true, view_docs: true, move_clients: false,
      workload: false, view_cpa_hours: false, export_data: false, settings: false,
      audit_logs: false, manage_roles: false,
    },
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState(null);

  const togglePerm = (k) => setForm((f) => ({ ...f, permissions: { ...f.permissions, [k]: !f.permissions[k] } }));
  const canonicalRole = useMemo(() => {
    if (form.role === "CPA") return "CPA";
    if (form.role === "Partner") return "WS_PARTNER";
    return "ADMIN"; // Admin / Manager / Other -> ADMIN canonical
  }, [form.role]);

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
      await onDone();
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="add-member-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 460, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Add member</h2>
          <button onClick={onClose} data-testid="add-member-close"><X size={18} /></button>
        </div>
        {link ? (
          <div className="stack-md">
            <div className="muted" style={{ fontSize: 13 }}>Invitation created. Share this link if SES is in sandbox:</div>
            <code style={{ display: "block", padding: 12, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all" }} data-testid="invite-link">{link}</code>
            <button onClick={onClose} style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#1e88e5", color: "#fff", fontWeight: 500 }} data-testid="add-member-done">Done</button>
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
                <input type="email" className="input" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="add-email" />
              </div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, margin: "20px 0 8px" }}>Choose role</div>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="add-role">
              {DISPLAY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>

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

            {err && <div className="alert alert-risk" style={{ marginTop: 12 }}>{err}</div>}

            <button
              onClick={submit}
              disabled={busy || !form.email || !form.first_name}
              style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#1e88e5", color: "#fff", fontWeight: 500, fontSize: 14, marginTop: 20 }}
              data-testid="add-member-submit"
            >{busy ? "Adding…" : "Add member"}</button>
            <button onClick={onClose} style={{ width: "100%", padding: "12px", borderRadius: 8, background: "var(--bg-subtle)", fontSize: 13, marginTop: 8 }}>Cancel</button>
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

  const load = async () => {
    try { const { data } = await api.get("/users/team"); setTeam(data); } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

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

  return (
    <div data-testid="settings-roles-tab">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Roles & Permissions</h3>
          <p className="muted" style={{ fontSize: 13 }}>Admin role has full access to all features</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 8, background: "#1e88e5", color: "#fff", fontSize: 13, fontWeight: 500 }}
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
                      <div className="avatar avatar-sm" style={{ flexShrink: 0 }}>{initials(u.name)}</div>
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onDone={load} />}
    </div>
  );
}

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "notifications", label: "Notifications" },
  { key: "documents", label: "Documents" },
  { key: "display", label: "Display" },
  { key: "roles", label: "Roles & Permissions" },
];

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
        <Link to="/admin/dashboard" className="muted flex items-center gap-2" style={{ fontSize: 13, width: "fit-content", textDecoration: "none" }} data-testid="back-to-portal">
          <ArrowLeft size={14} /> Back to portal
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
          {tab === "profile" && <ProfileTab me={me} refresh={refresh} />}
          {tab === "notifications" && <NotificationsTab me={me} refresh={refresh} />}
          {tab === "documents" && <DocumentsTab />}
          {tab === "display" && <DisplayTab />}
          {tab === "roles" && <RolesTab />}
        </div>

        <div style={{ height: 60 }} />
      </div>
    </div>
  );
}
