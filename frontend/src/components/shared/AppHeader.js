import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { initials } from "../../lib/api";
import { LogOut } from "lucide-react";

export default function AppHeader({ tabs = [] }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
            {tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className={`nav-tab ${location.pathname.startsWith(t.to) ? "active" : ""}`}
                data-testid={`nav-${t.key}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="avatar avatar-sm" data-testid="user-avatar">{initials(user?.name || "")}</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }} data-testid="user-name">{user?.name}</div>
            <div className="tertiary" style={{ fontSize: 11 }}>{user?.email}</div>
          </div>
        </div>
        <button className="btn btn-ghost" onClick={async () => { await logout(); navigate("/login"); }} data-testid="logout-btn">
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </header>
  );
}
