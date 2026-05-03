import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate, initials } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import EngagementTable, { ViewToggle } from "../components/shared/EngagementTable";
import UsersTable from "../components/shared/UsersTable";
import { Plus, X } from "lucide-react";

const COLUMNS = [
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In prep" },
  { key: "IN_REVIEW", label: "Review" },
  { key: "FILED", label: "Filed" },
];

function AdminCard({ eng, onClick }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const needsCpa = !eng.assigned_cpa_id && eng.status === "REFERRED";
  const isFiled = eng.status === "FILED";
  const craRef = eng.cra_confirmation_number || (isFiled ? `CRA-${(eng.id || "").slice(0, 6).toUpperCase()}` : null);
  const displayName = (/^dr\.?\s/i).test(client.name || "") ? client.name : `Dr. ${client.name || "—"}`;
  return (
    <div className="kanban-card" onClick={onClick} data-testid={`admin-card-${eng.id}`} style={{ cursor: "pointer", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{displayName}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{corp.name}</div>
        </div>
        <TierBadge tier={eng.tier} />
      </div>
      {needsCpa ? (
        <div className="mt-3 flex items-center gap-1" style={{ fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f57f17" }} />
          <span style={{ color: "#f57f17", fontWeight: 500 }}>Needs CPA assignment</span>
        </div>
      ) : isFiled ? (
        <div style={{ marginTop: 12 }}>
          {craRef && <span className="badge" style={{ background: "#fff3e0", color: "#ef6c00", fontSize: 11, fontWeight: 600 }}>{craRef}</span>}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Filed {fmtDate(eng.filing_date)}</div>
        </div>
      ) : (
        <>
          {eng.assigned_cpa && <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>CPA: {eng.assigned_cpa.name}</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Day {eng.days_elapsed || 0}</div>
        </>
      )}
    </div>
  );
}

function AddCpaModal({ onClose, onDone }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState(null);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const { data } = await api.post("/users/invite", {
        email: form.email,
        name: `${form.first_name} ${form.last_name}`.trim(),
        role: "CPA",
        display_role: "CPA",
        phone: form.phone || null,
      });
      setLink(data.invite_link);
      await onDone();
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="add-cpa-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 460, maxHeight: "90vh", overflowY: "auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Add CPA</h2>
          <button onClick={onClose} data-testid="add-cpa-close"><X size={18} /></button>
        </div>
        {link ? (
          <div className="stack-md">
            <div className="muted" style={{ fontSize: 13 }}>Invitation sent. You can copy this link and share it directly if needed:</div>
            <code style={{ display: "block", padding: 12, background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all" }} data-testid="cpa-invite-link">{link}</code>
            <button onClick={onClose} className="btn btn-primary w-full" data-testid="add-cpa-done">Done</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>CPA information</div>
            <div className="stack-md">
              <div className="field"><label className="field-label">FIRST NAME</label>
                <input className="input" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} data-testid="cpa-first-name" /></div>
              <div className="field"><label className="field-label">LAST NAME</label>
                <input className="input" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="cpa-last-name" /></div>
              <div className="field"><label className="field-label">EMAIL</label>
                <input type="email" className="input" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="cpa-email" /></div>
              <div className="field"><label className="field-label">PHONE (OPTIONAL)</label>
                <input className="input" placeholder="(555) 123-4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="cpa-phone" /></div>
            </div>
            <div style={{ marginTop: 20, padding: 14, borderLeft: "3px solid #1e88e5", background: "var(--bg-subtle)", borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Default CPA permissions will be granted</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>View Clients · Send Reminders · Send Messages · View Docs · View CPA Hours</div>
            </div>
            {err && <div className="alert alert-risk" style={{ marginTop: 12 }}>{err}</div>}
            <button onClick={submit} disabled={busy || !form.email || !form.first_name}
              className="btn btn-primary w-full"
              style={{ marginTop: 20 }}
              data-testid="add-cpa-submit"
            >{busy ? "Adding…" : "Add CPA"}</button>
            <button onClick={onClose} className="btn btn-secondary w-full" style={{ marginTop: 8 }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

function EditProfileModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "", is_active: !!user.is_active });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      await api.patch(`/users/${user.id}`, { name: form.name, phone: form.phone || null, is_active: form.is_active });
      await onSaved();
      onClose();
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} data-testid="edit-profile-modal">
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 420, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600 }}>Edit profile</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="stack-md">
          <div className="field"><label className="field-label">NAME</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="edit-name" /></div>
          <div className="field"><label className="field-label">EMAIL</label>
            <input className="input" value={user.email} disabled /></div>
          <div className="field"><label className="field-label">PHONE</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="edit-phone" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", padding: "10px 0" }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} data-testid="edit-active" />
            <span>Account active</span>
          </label>
          {err && <div className="alert alert-risk">{err}</div>}
          <button onClick={submit} disabled={busy} style={{ width: "100%", padding: "12px", borderRadius: 8, background: "#1a1a1a", color: "#fff", fontWeight: 500, fontSize: 14 }} data-testid="edit-save">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function CpasTab({ engs }) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/users");
      // Only show active experts (CPA + ADMIN). The /users endpoint already
      // filters out soft-deleted rows, but we double-guard here in case
      // clients cache an older payload.
      setUsers(
        data
          .filter((u) => (u.role === "CPA" || u.role === "ADMIN") && u.is_active !== false)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      );
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  // Compute team capacity
  const cpaCount = users.filter((u) => u.role === "CPA").length;
  const totalClients = engs.length;
  const avgPerCpa = cpaCount > 0 ? (totalClients / cpaCount).toFixed(1) : "0";
  const pendingAssignment = engs.filter((e) => !e.assigned_cpa_id).length;

  // Clients per CPA / Admin
  const clientsForUser = (uid) => engs.filter((e) => e.assigned_cpa_id === uid).length;

  const roleBadge = (role) => {
    const map = {
      ADMIN: { bg: "#fce4ec", fg: "#c2185b", label: "Admin" },
      CPA: { bg: "#ede7f6", fg: "#5e35b1", label: "CPA" },
    };
    return map[role] || { bg: "#eceff1", fg: "#546e7a", label: role };
  };

  return (
    <div data-testid="admin-cpas-tab">
      {err && <div className="alert alert-risk">{err}</div>}

      {/* Team capacity — match Users-tab stat-card style for a unified look */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Team capacity</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }} data-testid="team-capacity">
        <div className="card" style={{ padding: 16 }} data-testid="cap-total-clients-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Total clients</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-total-clients">{totalClients}</div>
        </div>
        <div className="card" style={{ padding: 16 }} data-testid="cap-avg-per-cpa-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Avg per CPA</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-avg-per-cpa">{avgPerCpa}</div>
        </div>
        <div className="card" style={{ padding: 16 }} data-testid="cap-pending-card">
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Pending assignment</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }} data-testid="cap-pending">{pendingAssignment}</div>
        </div>
      </div>

      {/* Experts */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Experts</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="btn btn-primary"
          data-testid="add-cpa-open"
        ><Plus size={14} /> Add CPA</button>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="experts-table">
          <thead>
            <tr style={{ background: "var(--bg-subtle)" }}>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>NAME</th>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>ROLE</th>
              <th style={{ textAlign: "left", padding: "14px 24px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5 }}>CLIENTS</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const rb = roleBadge(u.role);
              return (
                <tr key={u.id} style={{ borderTop: "1px solid var(--border-default)" }} data-testid={`expert-row-${u.id}`}>
                  <td style={{ padding: "18px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div className="avatar avatar-sm">{initials(u.name)}</div>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "18px 24px" }}>
                    <span style={{ background: rb.bg, color: rb.fg, padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>{rb.label}</span>
                  </td>
                  <td style={{ padding: "18px 24px", fontSize: 14 }}>{clientsForUser(u.id)}</td>
                  <td style={{ padding: "18px 24px", textAlign: "right" }}>
                    <button onClick={() => setEditing(u)} style={{ color: "#1e88e5", fontSize: 13, fontWeight: 500 }} data-testid={`edit-profile-${u.id}`}>Edit profile</button>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 32, textAlign: "center" }}>No experts yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && <AddCpaModal onClose={() => setShowAdd(false)} onDone={load} />}
      {editing && <EditProfileModal user={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("clients");
  const [view, setView] = useState(() => localStorage.getItem("ct_admin_dash_view") || "kanban");

  const load = async () => {
    try { const { data } = await api.get("/engagements"); setEngs(data); } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem("ct_admin_dash_view", v); } catch { /* ignore */ }
  };

  const adminTabs = [
    { key: "clients", label: "Clients" },
    { key: "cpas", label: "CPA's" },
    { key: "users", label: "Users" },
  ];

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg" style={{ paddingTop: 12 }}>
        <div data-testid="admin-tabs" style={{ display: "flex", gap: 28, borderBottom: "1px solid var(--border-default)", marginBottom: 32 }}>
          {adminTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`admin-${t.key}-tab`}
              style={{
                padding: "12px 4px",
                fontSize: 14,
                fontWeight: tab === t.key ? 600 : 500,
                color: tab === t.key ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: tab === t.key ? "2px solid #1565c0" : "2px solid transparent",
                marginBottom: -1,
              }}
            >{t.label}</button>
          ))}
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        {tab === "clients" && (
          <>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}
              data-testid="admin-clients-toolbar"
            >
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Clients pipeline</h2>
              <ViewToggle value={view} onChange={setViewPersist} testid="admin-view-toggle" />
            </div>
            {view === "kanban" ? (
              <div className="kanban" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))` }} data-testid="admin-kanban">
                {COLUMNS.map((col) => {
                  const items = engs.filter((e) => e.status === col.key);
                  return (
                    <div className="kanban-col" key={col.key} data-testid={`admin-kanban-col-${col.key}`}>
                      <div className="kanban-col-header">
                        <div>
                          <div className="kanban-col-title">{col.label}</div>
                          <div className="kanban-col-count">{items.length}</div>
                        </div>
                      </div>
                      <div className="stack-sm">
                        {items.map((e) => <AdminCard key={e.id} eng={e} onClick={() => navigate(`/admin/client/${e.id}`)} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EngagementTable
                engagements={engs}
                onRowClick={(e) => navigate(`/admin/client/${e.id}`)}
                role="ADMIN"
                testid="admin-engagement-table"
              />
            )}
          </>
        )}

        {tab === "cpas" && <CpasTab engs={engs} />}

        {tab === "users" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700 }}>Users</h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>All users across CloudTax — search, filter, and manage lifecycle.</p>
              </div>
            </div>
            <UsersTable navigate={navigate} />
          </>
        )}
      </div>
    </div>
  );
}
