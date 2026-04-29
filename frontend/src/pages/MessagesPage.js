import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search, ArrowLeft } from "lucide-react";
import { api, fmtError } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import UserAvatar from "../components/shared/UserAvatar";
import { ChatThread } from "./Messages";

function timeAgo(iso) {
  if (!iso) return "";
  const isoUtc = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z";
  const d = new Date(isoUtc);
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return s < 10 ? "just now" : `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const dd = Math.floor(h / 24);
  if (dd < 7) return `${dd}d`;
  return d.toLocaleDateString();
}

/**
 * Full-page Messages inbox for ADMIN and CPA roles. Two-pane layout:
 *  • left: filterable conversation list (drives unread badges + last preview)
 *  • right: ChatThread for the selected engagement (re-uses existing SSE)
 */
export default function MessagesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const activeId = sp.get("eid");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/messages/inbox");
      setItems(data || []);
    } catch (e) { setErr(fmtError(e)); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, []);

  const filtered = items.filter((r) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (r.client?.name || "").toLowerCase().includes(q) ||
      (r.corporation?.name || "").toLowerCase().includes(q) ||
      (r.last_message?.content || "").toLowerCase().includes(q)
    );
  });

  const active = activeId ? items.find((r) => r.engagement_id === activeId) : null;

  const setActive = (eid) => {
    if (!eid) sp.delete("eid"); else sp.set("eid", eid);
    setSp(sp, { replace: true });
  };

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide" data-testid="messages-page">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 className="page-title">Messages</h1>
          <button onClick={() => navigate(-1)} className="btn-link" data-testid="messages-page-back">
            <ArrowLeft size={12} /> Back
          </button>
        </div>
        {err && <div className="alert alert-risk" style={{ marginBottom: 12 }}>{err}</div>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 360px) 1fr",
            gap: 16,
            background: "transparent",
            minHeight: "calc(100vh - 220px)",
          }}
        >
          {/* List */}
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--border-default)",
              borderRadius: 12,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              minHeight: 480,
            }}
            data-testid="messages-page-list"
          >
            <div style={{ padding: 12, borderBottom: "1px solid var(--border-default)" }}>
              <div style={{ position: "relative" }}>
                <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
                <input
                  className="input"
                  style={{ paddingLeft: 30, height: 34, fontSize: 12 }}
                  placeholder="Search by client, corporation, message…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  data-testid="messages-page-search"
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
              {filtered.map((r) => {
                const last = r.last_message;
                const preview = last?.content || (last?.attachment_name ? `📎 ${last.attachment_name}` : "No messages yet");
                const isActive = r.engagement_id === activeId;
                return (
                  <button
                    key={r.engagement_id}
                    onClick={() => setActive(r.engagement_id)}
                    data-testid={`messages-page-row-${r.engagement_id}`}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "12px 14px", display: "flex", gap: 12,
                      borderTop: "1px solid var(--border-subtle, #f0eeea)",
                      background: isActive ? "#eef4fb" : (r.unread_count > 0 ? "#f9fbff" : "transparent"),
                      borderLeft: isActive ? "3px solid #1565c0" : (r.unread_count > 0 ? "3px solid #90caf9" : "3px solid transparent"),
                      cursor: "pointer",
                      transition: "background-color 120ms ease",
                    }}
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
                          display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden",
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
                      >{r.unread_count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Conversation */}
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--border-default)",
              borderRadius: 12,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              minHeight: 480,
            }}
            data-testid="messages-page-thread"
          >
            {!active ? (
              <div className="muted" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", fontSize: 13 }}>
                Select a conversation to start chatting.
              </div>
            ) : (
              <>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 12 }}>
                  <UserAvatar user={active.client} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{active.client?.name || "—"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{active.corporation?.name || ""}</div>
                  </div>
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
                  <ChatThread
                    engagementId={active.engagement_id}
                    headerUser={null}
                    hideHeader={true}
                    mineRightAlign={true}
                    mineColor="dark"
                    height={520}
                    onUnreadChange={() => load()}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
