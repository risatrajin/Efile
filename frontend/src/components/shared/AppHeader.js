import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { LogOut, Settings, Home } from "lucide-react";
import NotificationBell from "./NotificationBell";
import AccessibilityMenu from "./AccessibilityMenu";
import MessagesInboxButton from "./MessagesInboxButton";
import UserAvatar from "./UserAvatar";

function dashboardPathFor(role) {
  if (role === "CLIENT") return "/portal";
  if (role === "WS_PARTNER") return "/ws/dashboard";
  if (role === "CPA") return "/cpa/files";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/";
}

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

  const settingsPath = user?.role === "ADMIN"
    ? "/admin/settings"
    : (user?.role === "CLIENT" ? "/portal/account" : "/account");

  const onSignOut = async () => { await logout(); navigate("/login"); };

  const workspaceLabel = user?.role === "WS_PARTNER" ? "Partner workspace"
    : user?.role === "CPA" ? "CPA workspace"
    : user?.role === "CLIENT" ? "Client Portal"
    : user?.role === "ADMIN" ? "Admin" : null;

  return (
    <header className="app-header" data-testid="app-header">
      <div className="app-header-inner">
        <Link to="/" className="brand-link" data-testid="brand-logo" style={{ display: "inline-flex", alignItems: "center" }}>
          <img src="/cloud-tax-logo.svg" alt="CloudTax" style={{ height: 22, width: "auto" }} />
        </Link>
        {workspaceLabel && user?.role !== "ADMIN" && (
          <span data-testid="workspace-pill" style={{
            padding: "6px 14px", borderRadius: 999,
            background: "var(--bg-subtle)", color: "var(--text-primary)",
            fontSize: 13, fontWeight: 500, marginLeft: 8,
          }}>{workspaceLabel}</span>
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
      <div className="flex items-center gap-2" style={{ position: "relative" }}>
        {/* Home — first item; navigates to the role-appropriate dashboard. */}
        <button
          onClick={() => navigate(dashboardPathFor(user?.role))}
          data-testid="header-home-icon"
          title="Dashboard"
          aria-label="Go to dashboard"
          style={{ width: 36, height: 36, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "background-color 120ms ease" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <Home size={18} />
        </button>
        {(user?.role === "ADMIN" || user?.role === "CPA" || user?.role === "CLIENT") && <MessagesInboxButton />}
        <NotificationBell />
        <AccessibilityMenu />
        <div style={{ width: 1, height: 24, background: "var(--border-default)", margin: "0 4px" }} />
        {/* Avatar pill — moved to where Sign Out used to live. Sign Out is now ONLY available inside this dropdown. */}
        <div ref={ref} style={{ position: "relative" }}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2"
            style={{ padding: "4px 12px 4px 4px", borderRadius: 999, transition: "background-color 120ms ease", border: "1px solid transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
            data-testid="header-avatar"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <UserAvatar user={user} size={28} testid="user-avatar" />
            <div style={{ textAlign: "left", lineHeight: 1.15 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }} data-testid="user-name">{user?.name}</div>
              <div className="tertiary" style={{ fontSize: 11 }} data-testid="user-email">{user?.email}</div>
            </div>
          </button>
          {open && (
            <div data-testid="user-menu" role="menu" style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "#fff", border: "1px solid var(--border-default)", borderRadius: 12,
              padding: 8, minWidth: 240, boxShadow: "0 12px 32px rgba(0,0,0,0.10)", zIndex: 30,
            }}>
              <div style={{ padding: "8px 12px 10px", borderBottom: "1px solid var(--border-default)" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.name}</div>
                <div className="tertiary" style={{ fontSize: 11 }}>{user?.email}</div>
              </div>
              <button
                role="menuitem"
                onClick={() => { setOpen(false); navigate(settingsPath); }}
                className="flex items-center gap-2"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, color: "var(--text-primary)", fontSize: 13, textAlign: "left", transition: "background-color 120ms ease", marginTop: 6 }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                data-testid="header-account-link"
              >
                <Settings size={14} /> {user?.role === "ADMIN" ? "Settings" : "Account settings"}
              </button>
              <button
                role="menuitem"
                onClick={async () => { setOpen(false); await onSignOut(); }}
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
      </div>
    </header>
  );
}
