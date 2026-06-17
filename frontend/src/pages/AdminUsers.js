import React, { useEffect, useState } from "react";
import { api, fmtError, fmtDate } from "../lib/api";
import { vendorLeakMarker } from "../lib/linkSafety";
import AppHeader from "../components/shared/AppHeader";
import { AlertTriangle, Plus } from "lucide-react";

function InviteModal({ onClose, onDone }) {
  const [form, setForm] = useState({ email: "", name: "", role: "CPA", phone: "" });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/users/invite", form);
      setLink(data.invite_link);
      await onDone();
    } catch (e) { setErr(fmtError(e)); }
    finally { setBusy(false); }
  };
  const leak = vendorLeakMarker(link);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Invite user</h2>
        {link ? (
          <div className="stack-md mt-4">
            <p className="muted" style={{ fontSize: 13 }}>Invitation email sent. You can copy this link and share it directly if needed:</p>
            {leak && (
              <div
                data-testid="invite-link-vendor-warning"
                style={{ background: "#ffebee", border: "1px solid #ffcdd2", color: "#a10f0f", borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 1.55, display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Do not share this link.</strong> It points at a non-production host (<code>{leak}</code>). Ask your deploy operator to set <code>FRONTEND_URL</code> to the customer-facing domain and redeploy — then re-send the invitation. See Settings → System for details.
                </div>
              </div>
            )}
            <code style={{ display: "block", padding: 12, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all", opacity: leak ? 0.55 : 1 }} data-testid="invite-link">{link}</code>
            <button className="btn btn-primary" onClick={onClose} data-testid="invite-close">Done</button>
          </div>
        ) : (
          <div className="stack-md mt-4">
            <div className="field"><label className="field-label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" data-testid="invite-email" /></div>
            <div className="field"><label className="field-label">Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" data-testid="invite-name" /></div>
            <div className="field"><label className="field-label">Role</label>
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="invite-role">
                <option value="CLIENT">Client (physician)</option>
                <option value="CPA">CPA</option>
                <option value="WS_PARTNER">Ownr partner</option>
                <option value="ADMIN">Admin</option>
              </select></div>
            <div className="field"><label className="field-label">Phone (optional)</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 (416) 555-0000" /></div>
            {err && <div className="alert alert-risk">{err}</div>}
            <div className="flex gap-2" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !form.email || !form.name} onClick={submit} data-testid="invite-submit">
                {busy ? <span className="spinner" /> : "Send invite"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try { const { data } = await api.get("/users"); setUsers(data); } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const toggleActive = async (u) => {
    try { await api.patch(`/users/${u.id}`, { is_active: !u.is_active }); await load(); } catch (x) { setErr(fmtError(x)); }
  };

  const tabs = [
    { key: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { key: "users", to: "/admin/users", label: "Users" },
  ];

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        <div className="flex between items-center">
          <div>
            <h1 className="page-title">Users</h1>
            <p className="muted" style={{ fontSize: 13 }}>Manage access across all roles</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShow(true)} data-testid="invite-open"><Plus size={14} /> Invite user</button>
        </div>
        {err && <div className="alert alert-risk">{err}</div>}
        <div className="card" style={{ padding: 8 }}>
          <table className="table" data-testid="users-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-testid={`user-row-${u.id}`}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td><span className="badge badge-neutral">{u.role}</span></td>
                  <td className="muted">{fmtDate(u.created_at)}</td>
                  <td>{u.is_active ? <span className="badge badge-complete">active</span> : <span className="badge badge-risk">disabled</span>}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u)} data-testid={`toggle-${u.id}`}>{u.is_active ? "Disable" : "Enable"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {show && <InviteModal onClose={() => setShow(false)} onDone={load} />}
    </div>
  );
}
