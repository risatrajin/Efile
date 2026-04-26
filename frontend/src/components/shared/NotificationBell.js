import React, { useEffect, useRef, useState } from "react";
import { Bell, FileText, AlertCircle, ArrowRightCircle, UserPlus, CheckCircle2 } from "lucide-react";
import { api } from "../../lib/api";

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  return `${dd}d ago`;
}

function iconFor(type) {
  const map = {
    document_uploaded: { Icon: FileText, color: "#2e7d32", bg: "#e8f5e9" },
    document_issue: { Icon: AlertCircle, color: "#ef6c00", bg: "#fff3e0" },
    status_advanced: { Icon: ArrowRightCircle, color: "#1565c0", bg: "#e3f2fd" },
    new_referral: { Icon: UserPlus, color: "#5e35b1", bg: "#ede7f6" },
    filing_complete: { Icon: CheckCircle2, color: "#2e7d32", bg: "#e8f5e9" },
  };
  return map[type] || { Icon: Bell, color: "#616161", bg: "#f5f5f5" };
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = async () => {
    try {
      const [a, b] = await Promise.all([api.get("/notifications"), api.get("/notifications/unread-count")]);
      setItems(a.data || []);
      setUnread(b.data?.count || 0);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markAll = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems(items.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="notification-bell"
        style={{
          position: "relative", width: 36, height: 36, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 120ms ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <Bell size={18} style={{ color: "var(--text-primary)" }} />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            style={{
              position: "absolute", top: 4, right: 4, minWidth: 16, height: 16,
              padding: "0 4px", borderRadius: 999, background: "#e53935", color: "#fff",
              fontSize: 10, fontWeight: 600, display: "inline-flex",
              alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div
          data-testid="notification-dropdown"
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0,
            background: "#fff", border: "1px solid var(--border-default)", borderRadius: 14,
            width: 360, maxHeight: 520, overflow: "hidden",
            boxShadow: "0 16px 48px rgba(0,0,0,0.12)", zIndex: 40,
            display: "flex", flexDirection: "column",
          }}
        >
          <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Notifications</span>
              {unread > 0 && (
                <span style={{ background: "#1565c0", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 600, padding: "2px 8px" }}>
                  {unread}
                </span>
              )}
            </div>
            <button onClick={markAll} data-testid="mark-all-read" style={{ color: "#1565c0", fontSize: 12, fontWeight: 500 }}>
              Mark all read
            </button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {items.length === 0 && (
              <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>No notifications</div>
            )}
            {items.map((n) => {
              const { Icon, color, bg } = iconFor(n.type);
              return (
                <div
                  key={n.id}
                  data-testid={`notif-${n.id}`}
                  style={{
                    padding: "14px 18px", display: "flex", gap: 12,
                    borderTop: "1px solid var(--border-subtle, #f0eeea)",
                    background: n.is_read ? "transparent" : "#f9fbff",
                    borderLeft: n.is_read ? "3px solid transparent" : "3px solid #1565c0",
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, background: bg,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <Icon size={16} style={{ color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{n.title}</div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{n.message}</div>
                    <div className="tertiary" style={{ fontSize: 11, marginTop: 6 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {items.length > 0 && (
            <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border-subtle, #f0eeea)", textAlign: "center" }}>
              <span className="tertiary" style={{ fontSize: 11 }}>Showing {items.length} notifications</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
