import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtError, fmtDate } from "../../lib/api";
import UserAvatar from "./UserAvatar";
import { MoreVertical, Mail, Pencil, Trash2, Power, PowerOff, Search, Users } from "lucide-react";

const STATUS_BADGES = {
  active:  { bg: "#e8f5e9", fg: "#1b5e20", label: "Active" },
  invited: { bg: "#fff8e1", fg: "#8a6d1a", label: "Invited" },
  removed: { bg: "#fdecea", fg: "#b71c1c", label: "Removed" },
};

const ROLE_BADGES = {
  ADMIN:      { bg: "#fce4ec", fg: "#ad1457", label: "Admin" },
  CPA:        { bg: "#ede7f6", fg: "#4527a0", label: "CPA" },
  PARTNER: { bg: "#e3f2fd", fg: "#0d47a1", label: "Partner" },
  CLIENT:     { bg: "#eceff1", fg: "#37474f", label: "Client" },
};

function Badge({ cfg, testid }) {
  return (
    <span
      data-testid={testid}
      style={{
        display: "inline-block", padding: "2px 8px", borderRadius: 999,
        background: cfg.bg, color: cfg.fg, fontSize: 10,
        fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3,
      }}
    >{cfg.label}</span>
  );
}

// Confirmation modal for destructive actions.
function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, busy, testid }) {
  return (
    <div className="modal-overlay" onClick={onCancel} data-testid={testid}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>{title}</h3>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)", marginBottom: 20 }}>{body}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-secondary btn-sm" onClick={onCancel} disabled={busy} data-testid={`${testid}-cancel`}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={onConfirm} disabled={busy} data-testid={`${testid}-confirm`}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersTable({ navigate }) {
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openMenu, setOpenMenu] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [confirm, setConfirm] = useState(null);   // {action, row}
  const [busy, setBusy] = useState(false);
  const [resendResult, setResendResult] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/users/all");
      setUsers(data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  // Close menu on outside click / scroll / resize.
  useEffect(() => {
    const onDoc = (e) => {
      if (!e.target.closest || !e.target.closest("[data-testid^='user-actions-']")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openMenu]);

  const toggleMenu = (uid, el) => {
    if (openMenu === uid) { setOpenMenu(null); return; }
    const rect = el.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenu(uid);
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (needle) {
        const hay = `${u.email || ""} ${u.name || ""} ${u.role || ""} ${u.display_role || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      return true;
    });
  }, [users, q, roleFilter, statusFilter]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => u.status === "invited").length,
    removed: users.filter((u) => u.status === "removed").length,
  }), [users]);

  const afterAction = async (msg) => {
    setInfo(msg); setErr(""); setConfirm(null);
    await load();
    setTimeout(() => setInfo(""), 3500);
  };

  const doResend = async (u) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/users/${u.id}/resend-invite`);
      setResendResult({ user: u, link: data.invite_link, emailSent: !!data.email_sent });
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const doDelete = async (u, permanent = false) => {
    setBusy(true);
    try {
      const url = permanent
        ? `/users/${u.id}?permanent=true`
        : `/users/${u.id}`;
      await api.delete(url);
      await afterAction(permanent
        ? `${u.name || u.email} was permanently deleted.`
        : `${u.name || u.email} was removed.`);
    } catch (x) { setErr(fmtError(x)); setConfirm(null); }
    setBusy(false);
  };

  const doDeactivate = async (u) => {
    setBusy(true);
    try {
      await api.post(`/users/${u.id}/deactivate`);
      await afterAction(`${u.name || u.email} is now inactive.`);
    } catch (x) { setErr(fmtError(x)); setConfirm(null); }
    setBusy(false);
  };

  const doReactivate = async (u) => {
    setBusy(true);
    try {
      await api.post(`/users/${u.id}/reactivate`);
      await afterAction(`${u.name || u.email} was reactivated.`);
    } catch (x) { setErr(fmtError(x)); setConfirm(null); }
    setBusy(false);
  };

  return (
    <div data-testid="admin-users-tab">
      {/* Top stats + filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
        {[
          { k: "total", l: "Total", n: counts.total },
          { k: "active", l: "Active", n: counts.active },
          { k: "invited", l: "Invited", n: counts.invited },
          { k: "removed", l: "Removed", n: counts.removed },
        ].map((c) => (
          <div key={c.k} className="card" style={{ padding: 16 }} data-testid={`users-stat-${c.k}`}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{c.l}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{c.n}</div>
          </div>
        ))}
      </div>

      <div className="users-filter-bar" data-testid="users-filter-bar">
        <div className="users-filter-search">
          <Search size={14} className="users-filter-search-icon" />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search by name, email, role…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="users-search"
          />
        </div>
        <select className="select users-filter-role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} data-testid="users-role-filter">
          <option value="all">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="CPA">CPA</option>
          <option value="PARTNER">Partner</option>
          <option value="CLIENT">Client</option>
        </select>
        <select className="select users-filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="users-status-filter">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="removed">Removed</option>
        </select>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>{filtered.length} of {users.length}</div>

      {err && <div className="alert alert-risk" data-testid="users-err">{err}</div>}
      {info && <div className="alert" data-testid="users-info" style={{ background: "#e8f5e9", border: "1px solid #c8e6c9", color: "#1b5e20", padding: "10px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{info}</div>}

      <div className="card" style={{ padding: 0, overflow: "visible" }} data-testid="users-table-card">
        <div style={{ overflow: "auto", borderRadius: "calc(var(--radius-card) - 1px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="users-table">
            <thead>
              <tr style={{ background: "var(--bg-subtle)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--text-secondary)" }}>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Member</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Email</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Role</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Status</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Created</th>
                <th style={{ padding: "12px 14px", textAlign: "left", fontWeight: 600 }}>Updated</th>
                <th style={{ padding: "12px 14px", textAlign: "right", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "40px 20px", textAlign: "center" }} data-testid="users-empty">
                    <Users size={32} style={{ color: "var(--text-secondary)", marginBottom: 8, opacity: 0.4 }} />
                    <div className="muted" style={{ fontSize: 13 }}>{users.length === 0 ? "No users yet" : "No users match your filters"}</div>
                  </td>
                </tr>
              )}
              {filtered.map((u) => {
                const roleKey = u.role === "CLIENT" || !u.role ? "CLIENT" : u.role;
                const roleBadge = ROLE_BADGES[roleKey] || ROLE_BADGES.CLIENT;
                const statusBadge = STATUS_BADGES[u.status] || STATUS_BADGES.active;
                return (
                  <tr key={u.id} data-testid={`user-row-${u.id}`} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <UserAvatar user={{ name: u.name, email: u.email, avatar_url: u.avatar_url }} size={32} />
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name || "—"}</div>
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 13, color: "var(--text-secondary)" }}>{u.email}</td>
                    <td style={{ padding: "12px 14px" }}><Badge cfg={roleBadge} testid={`user-role-badge-${u.id}`} /></td>
                    <td style={{ padding: "12px 14px" }}><Badge cfg={statusBadge} testid={`user-status-badge-${u.id}`} /></td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-secondary)" }}>{fmtDate(u.created_at)}</td>
                    <td style={{ padding: "12px 14px", fontSize: 12, color: "var(--text-secondary)" }}>{fmtDate(u.last_updated_at)}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {u.role !== "CLIENT" && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => navigate && u.role !== "CLIENT" ? null : null}
                          style={{ marginRight: 6, display: "none" }}
                        >View</button>
                      )}
                      <div style={{ display: "inline-block", position: "relative" }}>
                        <button
                          type="button"
                          onClick={(e) => toggleMenu(u.id, e.currentTarget)}
                          data-testid={`user-actions-trigger-${u.id}`}
                          style={{ padding: 6, borderRadius: 6, background: "transparent", border: "1px solid var(--border-default)", cursor: "pointer" }}
                          aria-label="Actions"
                        >
                          <MoreVertical size={14} />
                        </button>
                        {openMenu === u.id && menuAnchor && (
                          <div
                            data-testid={`user-actions-menu-${u.id}`}
                            style={{
                              position: "fixed", top: menuAnchor.top, right: menuAnchor.right,
                              background: "#fff", border: "1px solid var(--border-default)",
                              borderRadius: 8, minWidth: 210, padding: 6,
                              boxShadow: "0 8px 24px rgba(15,23,42,0.12)", zIndex: 3000,
                            }}
                          >
                            {u.role !== "CLIENT" && u.status !== "removed" && (
                              <button type="button" className="menu-item" onClick={() => { setOpenMenu(null); doResend(u); }} data-testid={`user-actions-resend-${u.id}`}>
                                <Mail size={13} /> {u.status === "invited" ? "Send invitation" : "Resend invitation"}
                              </button>
                            )}
                            {u.status === "active" && (
                              <button type="button" className="menu-item" onClick={() => { setOpenMenu(null); setConfirm({ action: "deactivate", row: u }); }} data-testid={`user-actions-deactivate-${u.id}`}>
                                <PowerOff size={13} /> Deactivate
                              </button>
                            )}
                            {(u.status === "removed") && (
                              <button type="button" className="menu-item" onClick={() => { setOpenMenu(null); setConfirm({ action: "reactivate", row: u }); }} data-testid={`user-actions-reactivate-${u.id}`}>
                                <Power size={13} /> Reactivate
                              </button>
                            )}
                            {u.status !== "removed" && (
                              <button type="button" className="menu-item menu-item-danger" onClick={() => { setOpenMenu(null); setConfirm({ action: "delete", row: u }); }} data-testid={`user-actions-delete-${u.id}`}>
                                <Trash2 size={13} /> Remove
                              </button>
                            )}
                            {u.status === "removed" && (
                              <button type="button" className="menu-item menu-item-danger" onClick={() => { setOpenMenu(null); setConfirm({ action: "permanent", row: u }); }} data-testid={`user-actions-permanent-delete-${u.id}`}>
                                <Trash2 size={13} /> Delete permanently
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation dialogs */}
      {confirm?.action === "delete" && (
        <ConfirmDialog
          title="Remove this user?"
          body={`${confirm.row.name || confirm.row.email} will be soft-deleted. Engagement history stays intact and the email is freed so they can be re-invited later.`}
          confirmLabel="Remove"
          testid="users-confirm-delete"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doDelete(confirm.row, false)}
        />
      )}
      {confirm?.action === "permanent" && (
        <ConfirmDialog
          title="Permanently delete this user?"
          body={`${confirm.row.name || confirm.row.email} will be erased from the database. This action is IRREVERSIBLE — the email can never be linked back to this account's activity log. Consider keeping them soft-deleted unless you need a hard purge.`}
          confirmLabel="Permanently delete"
          testid="users-confirm-permanent"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doDelete(confirm.row, true)}
        />
      )}
      {confirm?.action === "deactivate" && (
        <ConfirmDialog
          title="Deactivate this account?"
          body={`${confirm.row.name || confirm.row.email} will lose access immediately. You can reactivate them at any time from this table.`}
          confirmLabel="Deactivate"
          testid="users-confirm-deactivate"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doDeactivate(confirm.row)}
        />
      )}
      {confirm?.action === "reactivate" && (
        <ConfirmDialog
          title="Reactivate this user?"
          body={`${confirm.row.name || confirm.row.email} will be restored and their previous role will be reinstated.`}
          confirmLabel="Reactivate"
          testid="users-confirm-reactivate"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => doReactivate(confirm.row)}
        />
      )}

      {/* Resend result */}
      {resendResult && (
        <div className="modal-overlay" onClick={() => setResendResult(null)} data-testid="users-resend-result">
          <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Invitation sent</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)", marginBottom: 14 }}>
              {resendResult.emailSent
                ? <>A fresh invitation email was sent to <strong>{resendResult.user.email}</strong>.</>
                : <>Email delivery is currently unavailable. Share the link below manually.</>}
            </p>
            <div style={{ position: "relative", marginBottom: 16 }}>
              <code style={{ display: "block", padding: "10px 12px", background: "var(--bg-subtle)", borderRadius: 8, fontSize: 11, wordBreak: "break-all", border: "1px solid var(--border-default)" }}>{resendResult.link}</code>
            </div>
            <div style={{ textAlign: "right" }}>
              <button className="btn btn-primary btn-sm" onClick={() => setResendResult(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
