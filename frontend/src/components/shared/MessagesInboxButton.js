import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, X, Search, ArrowLeft } from "lucide-react";
import { api, fmtError } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import UserAvatar from "./UserAvatar";
import { ChatThread } from "../../pages/Messages";

function timeAgo(iso) {
  if (!iso) return "";
  const isoUtc = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(isoUtc);
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `${dd}d`;
  return d.toLocaleDateString();
}

export default function MessagesInboxButton() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(null); // selected conversation row
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  // ADMIN + CPA get a dedicated /admin|cpa/messages page; CLIENT keeps the
  // lightweight popover. (The popover would feel cramped for staff who reply
  // to many conversations a day.)
  const isStaff = user?.role === "ADMIN" || user?.role === "CPA";
  const staffPath = user?.role === "ADMIN" ? "/admin/messages" : "/cpa/messages";

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/messages/inbox");
      setItems(data || []);
      setUnreadTotal((data || []).reduce((s, r) => s + (r.unread_count || 0), 0));
    } catch (e) { setErr(fmtError(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    if (!open && !isStaff) return;
    if (isStaff) {
      // Staff: poll every 60s so the badge reflects unread count even without opening anything.
      const i = setInterval(load, 60000);
      return () => clearInterval(i);
    }
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, [open, isStaff]);

  // Close popover on outside-click only when no conversation is open (modal-style otherwise).
  // Disabled entirely for staff (popover never opens).
  useEffect(() => {
    if (isStaff) return;
    const onDoc = (e) => {
      if (active) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [active, isStaff]);

  const filtered = items.filter((r) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (r.client?.name || "").toLowerCase().includes(q) ||
      (r.corporation?.name || "").toLowerCase().includes(q) ||
      (r.last_message?.content || "").toLowerCase().includes(q)
    );
  });

  const closeAll = () => { setActive(null); setOpen(false); };

  const onIconClick = () => {
    if (isStaff) { navigate(staffPath); return; }
    setOpen((o) => !o);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={onIconClick}
        data-testid="header-messages-icon"
        title="Messages"
        aria-label="Open messages"
        style={{
          position: "relative", width: 36, height: 36, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 120ms ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <MessageSquare size={18} style={{ color: "var(--text-primary)" }} />
        {unreadTotal > 0 && (
          <span
            data-testid="messages-badge"
            style={{
              position: "absolute", top: 4, right: 4, minWidth: 16, height: 16,
              padding: "0 4px", borderRadius: 999, background: "#1565c0", color: "#fff",
              fontSize: 10, fontWeight: 600, display: "inline-flex",
              alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >{unreadTotal > 9 ? "9+" : unreadTotal}</span>
        )}
      </button>
      {open && !isStaff && (
        <div
          data-testid="messages-inbox"
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0,
            background: "#fff", border: "1px solid var(--border-default)", borderRadius: 14,
            width: 420, maxHeight: 600, overflow: "hidden",
            boxShadow: "0 16px 48px rgba(0,0,0,0.12)", zIndex: 50,
            display: "flex", flexDirection: "column",
          }}
        >
          {!active && (
            <>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>Messages</span>
                  {unreadTotal > 0 && (
                    <span style={{ background: "#1565c0", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 600, padding: "2px 8px" }}>
                      {unreadTotal} unread
                    </span>
                  )}
                </div>
                <div style={{ position: "relative" }}>
                  <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 30, height: 32, fontSize: 12 }}
                    placeholder="Search by client, corporation, message…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    data-testid="messages-inbox-search"
                  />
                </div>
              </div>
              <div style={{ overflowY: "auto", flex: 1 }}>
                {loading && items.length === 0 && (
                  <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>Loading…</div>
                )}
                {!loading && filtered.length === 0 && (
                  <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 13 }}>
                    {items.length === 0 ? "No conversations yet" : "No conversations match your search"}
                  </div>
                )}
                {err && <div className="alert alert-risk" style={{ margin: 12 }}>{err}</div>}
                {filtered.map((r) => {
                  const last = r.last_message;
                  const preview = last?.content || (last?.attachment_name ? `📎 ${last.attachment_name}` : "No messages yet");
                  return (
                    <button
                      key={r.engagement_id}
                      onClick={() => setActive(r)}
                      data-testid={`inbox-row-${r.engagement_id}`}
                      style={{
                        width: "100%", textAlign: "left",
                        padding: "12px 16px", display: "flex", gap: 12,
                        borderTop: "1px solid var(--border-subtle, #f0eeea)",
                        background: r.unread_count > 0 ? "#f9fbff" : "transparent",
                        borderLeft: r.unread_count > 0 ? "3px solid #1565c0" : "3px solid transparent",
                        cursor: "pointer",
                        transition: "background-color 120ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = r.unread_count > 0 ? "#eef4fb" : "var(--bg-subtle)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = r.unread_count > 0 ? "#f9fbff" : "transparent"; }}
                    >
                      <UserAvatar user={r.client} size={36} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {r.client?.name || "—"}
                          </span>
                          <span className="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{timeAgo(r.last_at)}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 1, marginBottom: 4 }}>{r.corporation?.name || ""}</div>
                        <div
                          className="muted"
                          style={{
                            fontSize: 12, lineHeight: 1.4,
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {preview}
                        </div>
                      </div>
                      {r.unread_count > 0 && (
                        <span
                          style={{
                            alignSelf: "flex-start",
                            background: "#1565c0", color: "#fff",
                            borderRadius: 999, fontSize: 10, fontWeight: 600,
                            padding: "2px 7px", marginTop: 4,
                          }}
                          data-testid={`inbox-unread-${r.engagement_id}`}
                        >
                          {r.unread_count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border-default)", textAlign: "center" }}>
                <span className="tertiary" style={{ fontSize: 11 }}>{filtered.length} of {items.length} conversation{items.length === 1 ? "" : "s"}</span>
              </div>
            </>
          )}

          {active && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="messages-inbox-thread">
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setActive(null)} className="btn btn-ghost btn-sm" data-testid="inbox-back" aria-label="Back to inbox">
                  <ArrowLeft size={14} />
                </button>
                <UserAvatar user={active.client} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{active.client?.name || "—"}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{active.corporation?.name || ""}</div>
                </div>
                <button onClick={closeAll} className="btn btn-ghost btn-sm" data-testid="inbox-close" aria-label="Close">
                  <X size={14} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: 12 }}>
                <ChatThread
                  engagementId={active.engagement_id}
                  headerUser={null}
                  hideHeader={true}
                  mineRightAlign={true}
                  mineColor="dark"
                  height={420}
                  onUnreadChange={() => load()}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
