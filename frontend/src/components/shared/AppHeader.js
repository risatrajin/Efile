import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { initials } from "../../lib/api";
import { LogOut, Settings } from "lucide-react";

export default function AppHeader({ tabs = [], unreadByKey = {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <header className="app-header" data-testid="app-header">
      <div className="app-header-inner">
        <div className="brand" data-testid="brand-logo">CloudTax</div>
        {user?.role && user.role !== "CLIENT" && (
          <div className="brand-badge" data-testid="role-badge">
            {user.role === "WS_PARTNER" ? "WS partner view" :
             user.role === "CPA" ? "CPA workspace" :
             user.role === "ADMIN" ? "Admin" : ""}
          </div>
        )}
        {tabs.length > 0 && (
          <nav className="nav-tabs" data-testid="nav-tabs">
            {tabs.map((t) => {
              const active = (t.matcher ? t.matcher(location.pathname) : location.pathname.startsWith(t.to));
              const unread = unreadByKey[t.key] || 0;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`nav-tab ${active ? "active" : ""}`}
                  data-testid={`nav-${t.key}`}
                  style={{ position: "relative" }}
                >
                  {t.label}
                  {unread > 0 && (
                    <span data-testid={`nav-${t.key}-badge`} style={{
                      position: "absolute", top: 2, right: -6, background: "#1565c0", color: "#fff",
                      fontSize: 9, fontWeight: 600, borderRadius: 10, padding: "0 6px", minWidth: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>{unread > 9 ? "9+" : unread}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
      <div className="flex items-center gap-3" ref={ref} style={{ position: "relative" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2"
          style={{ padding: "4px 10px 4px 4px", borderRadius: 999, transition: "background-color 120ms ease", border: "1px solid transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
          data-testid="header-avatar"
        >
          <div className="avatar avatar-sm" data-testid="user-avatar">{initials(user?.name || "")}</div>
          <span style={{ fontSize: 13, fontWeight: 500 }} data-testid="user-name">{user?.name}</span>
        </button>
        {open && (
          <div data-testid="user-menu" style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            background: "#fff", border: "1px solid var(--border-default)", borderRadius: 12,
            padding: 8, minWidth: 260, boxShadow: "0 12px 32px rgba(0,0,0,0.10)", zIndex: 30,
          }}>
            <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <div className="avatar">{initials(user?.name || "")}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
                <div className="tertiary" style={{ fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</div>
                {user?.role && user.role !== "CLIENT" && (
                  <div style={{ marginTop: 6 }}>
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                      {user.role === "WS_PARTNER" ? "Wealthsimple" : user.role === "CPA" ? "CPA" : "Admin"}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="divider" style={{ margin: "4px 0" }} />
            <button
              onClick={() => { setOpen(false); navigate(user?.role === "CLIENT" ? "/portal/account" : "/account"); }}
              className="flex items-center gap-2"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, textAlign: "left", transition: "background-color 120ms ease" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              data-testid="header-account-link"
            >
              <Settings size={14} /> Account settings
            </button>
            <button
              onClick={async () => { setOpen(false); await logout(); navigate("/login"); }}
              className="flex items-center gap-2"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, color: "#c62828", fontSize: 13, textAlign: "left", transition: "background-color 120ms ease" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--status-risk-bg)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              data-testid="header-logout-button"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
