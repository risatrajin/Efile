import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";

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
  return (
    <div className="kanban-card" onClick={onClick} data-testid={`admin-card-${eng.id}`} style={{ cursor: "pointer", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{(/^dr\.?\s/i).test(client.name || "") ? client.name : `Dr. ${client.name || "—"}`}</div>
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
          {craRef && (
            <span className="badge" style={{ background: "#fff3e0", color: "#ef6c00", fontSize: 11, fontWeight: 600 }}>{craRef}</span>
          )}
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

function CpasTab() {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/users");
        setUsers(data.filter((u) => u.role === "CPA"));
      } catch (x) { setErr(fmtError(x)); }
    })();
  }, []);
  return (
    <div className="card" style={{ padding: 8, marginTop: 24 }} data-testid="admin-cpas-tab">
      {err && <div className="alert alert-risk" style={{ margin: 12 }}>{err}</div>}
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email}</td>
              <td className="muted">{u.phone || "—"}</td>
              <td>{u.is_active ? <span className="badge badge-complete">active</span> : <span className="badge badge-risk">disabled</span>}</td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={4} className="muted" style={{ padding: 24, textAlign: "center" }}>No CPAs yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("clients");

  const load = async () => {
    try { const { data } = await api.get("/engagements"); setEngs(data); } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const adminTabs = [
    { key: "clients", label: "Clients", to: "/admin/dashboard", matcher: () => tab === "clients", onClick: () => setTab("clients") },
    { key: "cpas", label: "CPA's", to: "/admin/dashboard", matcher: () => tab === "cpas", onClick: () => setTab("cpas") },
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
              data-testid={`admin-tab-${t.key}`}
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
                    {items.length === 0 && <div className="tertiary" style={{ fontSize: 11, padding: 8, textAlign: "center" }}>No clients</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "cpas" && <CpasTab />}
      </div>
    </div>
  );
}
