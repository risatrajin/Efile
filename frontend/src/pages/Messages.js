import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOutletContext } from "react-router-dom";
import { api, fmtError, initials } from "../lib/api";
import { getToken } from "../lib/tokenStorage";
import { Paperclip, Send } from "lucide-react";

const BASE = process.env.REACT_APP_BACKEND_URL;

function fmtTs(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

/**
 * Reusable chat component used by both client and CPA views.
 * Pass `mineAlign="right" mineColor="blue"` for client, or right+gray for CPA depending on perspective.
 */
export function ChatThread({ engagementId, headerUser, mineRightAlign = true, mineColor = "blue", onUnreadChange, hideHeader = false, height = 540 }) {
  const { user } = useAuth();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef(null);
  const fileRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/engagements/${engagementId}/messages`);
      setMsgs(data);
      scrollToBottom();
    } catch (e) { setErr(fmtError(e)); }
  }, [engagementId, scrollToBottom]);

  const markRead = useCallback(async () => {
    try {
      await api.patch("/messages/read", { engagement_id: engagementId });
      onUnreadChange && onUnreadChange();
    } catch (e) { console.debug("[Messages] markRead failed:", e?.response?.status); }
  }, [engagementId, onUnreadChange]);

  useEffect(() => { if (!engagementId) return; setErr(""); load().then(markRead); }, [engagementId, load, markRead]);

  // SSE
  useEffect(() => {
    if (!engagementId) return;
    const token = getToken();
    if (!token) return;
    const url = `${BASE}/api/engagements/${engagementId}/messages/stream?token=${encodeURIComponent(token)}`;
    let es;
    try {
      es = new EventSource(url);
    } catch { return; }
    es.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(ev.data);
        setMsgs((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m]);
        scrollToBottom();
        if (m.sender?.id !== user?.id) markRead();
      } catch (e) { console.debug("[Messages] SSE parse failed:", e); }
    });
    es.onerror = () => { /* let it auto-retry */ };
    return () => { es && es.close(); };
  }, [engagementId, user?.id, scrollToBottom, markRead]);

  const send = async (e) => {
    e?.preventDefault?.();
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/engagements/${engagementId}/messages`, { content: text });
      setText("");
      // Don't refetch — SSE will deliver
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
  };

  const onAttach = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const ct = file.type || "application/octet-stream";
      const { data: presigned } = await api.post(`/engagements/${engagementId}/messages/attach-url`, {
        file_name: file.name,
        content_type: ct,
      });
      const putResp = await fetch(presigned.upload_url, {
        method: "PUT",
        headers: { "Content-Type": ct, "x-amz-server-side-encryption": "AES256" },
        body: file,
      });
      if (!putResp.ok) throw new Error(`Upload failed (${putResp.status})`);
      await api.post(`/engagements/${engagementId}/messages`, {
        content: text.trim() || `Sent ${file.name}`,
        attachment_url: presigned.object_key,
        attachment_name: file.name,
      });
      setText("");
    } catch (x) { setErr(fmtError(x)); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const downloadAttachment = async (mid) => {
    try {
      const { data } = await api.get(`/messages/${mid}/attachment-url`);
      window.open(data.download_url, "_blank");
    } catch (x) { setErr(fmtError(x)); }
  };

  const myColor = mineColor === "blue" ? "#1565c0" : "var(--accent-dark)";

  // Map a ``sender`` object → display metadata used by the chat row:
  //   • label   — human role tag shown in the per-group header ("Bookkeeper")
  //   • bg/fg   — avatar colors so roles are scannable at a glance
  //   • initials— fallback for the avatar when there is no profile image
  // Delegate relationships (bookkeeper / spouse / accountant / …) override
  // the raw role so the header reads "Susan Lee · Bookkeeper" rather than
  // the less informative "Susan Lee · Client".
  const roleMeta = (s) => {
    if (!s) return { label: "", bg: "#ebe7e0", fg: "#3a3a3a" };
    const rel = (s.delegate_relationship || "").toLowerCase();
    if (rel) {
      const pretty = { bookkeeper: "Bookkeeper", accountant: "Accountant", spouse: "Spouse", assistant: "Assistant", other: "Delegate" }[rel] || "Delegate";
      return { label: pretty, bg: "#d9c7a7", fg: "#3a2b10" };   // warm tan
    }
    switch (s.role) {
      case "CLIENT":     return { label: "Client",    bg: "#d7d4cf", fg: "#3a3a3a" }; // neutral gray
      case "CPA":        return { label: "CPA",       bg: "#c8dbef", fg: "#0d3a66" }; // brand blue
      case "ADMIN":      return { label: "Admin",     bg: "#8f8c87", fg: "#fff" };    // darker neutral
      case "PARTNER": return { label: "Partner", bg: "#1a1a1a", fg: "#fff" };
      default:           return { label: s.role || "", bg: "#ebe7e0", fg: "#3a3a3a" };
    }
  };

  // Initials fallback that prefers first-2 of the first token + first of
  // the second token when a name has two parts ("Rajin Sharma" → "RaS").
  // Falls back to the shared ``initials()`` helper otherwise.
  const richInitials = (name) => {
    if (!name) return "";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].slice(0, 2) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
    return initials(name);
  };

  // Group-break rule: start a new sender-group when the sender changes or
  // when more than 5 minutes have elapsed since the previous message. The
  // header (name · role · time) only renders on the FIRST message of each
  // group, iMessage / Slack style. Self-messages never render a header.
  const GROUP_BREAK_MS = 5 * 60 * 1000;
  const fmtTimeShort = (iso) => {
    try { return new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };

  return (
    <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column", height }} data-testid="chat-thread">
      {!hideHeader && headerUser && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 20, borderBottom: "1px solid var(--border-default)" }}>
          <div className="avatar" style={{ width: 40, height: 40 }}>{initials(headerUser.name || "")}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{headerUser.name}</div>
            <div className="tertiary" style={{ fontSize: 11 }}>{headerUser.subtitle || "Your tax professional"}</div>
          </div>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 24, background: "var(--bg-card)" }} data-testid="chat-scroll">
        {msgs.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 40, fontSize: 13 }}>No messages yet. Say hello!</div>}
        {msgs.map((m, idx) => {
          const mine = m.sender?.id === user?.id;
          const align = mine ? (mineRightAlign ? "flex-end" : "flex-start") : (mineRightAlign ? "flex-start" : "flex-end");
          const bg = mine ? myColor : "#ebe7e0";
          const fg = mine ? "#fff" : "var(--text-primary)";
          const prev = idx > 0 ? msgs[idx - 1] : null;
          const samePrevSender = prev && prev.sender?.id === m.sender?.id;
          const withinGap = prev && (new Date(m.created_at) - new Date(prev.created_at)) < GROUP_BREAK_MS;
          const isGroupHead = !mine && m.sender && !(samePrevSender && withinGap);
          const meta = roleMeta(m.sender);
          const tooltipParts = [m.sender?.name, meta.label, m.sender?.email].filter(Boolean);
          const tooltip = tooltipParts.join(" · ");
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: align, marginBottom: isGroupHead ? 4 : 8 }} data-testid={`msg-${m.id}`}>
              <div style={{ maxWidth: "70%" }}>
                {isGroupHead && (
                  <div
                    className="flex items-center gap-2"
                    style={{ marginBottom: 4, marginLeft: 44 }}
                    data-testid={`msg-group-head-${m.id}`}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{m.sender.name}</span>
                    <span className="tertiary" style={{ fontSize: 11 }}>·</span>
                    <span className="tertiary" style={{ fontSize: 11 }}>{meta.label}</span>
                    <span className="tertiary" style={{ fontSize: 11 }}>·</span>
                    <span className="tertiary" style={{ fontSize: 11 }}>{fmtTimeShort(m.created_at)}</span>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexDirection: align === "flex-end" ? "row-reverse" : "row" }}>
                  {!mine && (
                    <div
                      className="avatar avatar-sm"
                      title={tooltip}
                      data-testid={`msg-avatar-${m.id}`}
                      style={{
                        width: 36, height: 36,
                        background: meta.bg, color: meta.fg,
                        fontSize: 11, fontWeight: 600,
                        // Invisible placeholder for continuation messages so
                        // bubbles line up with the group-head avatar's column.
                        visibility: isGroupHead ? "visible" : "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {richInitials(m.sender?.name || "")}
                    </div>
                  )}
                  <div style={{ background: bg, color: fg, padding: "10px 14px", borderRadius: 16, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {m.content}
                    {m.attachment_name && (
                      <button
                        onClick={() => downloadAttachment(m.id)}
                        data-testid={`attachment-${m.id}`}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          marginTop: m.content ? 8 : 0,
                          padding: "6px 10px",
                          background: mine ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.06)",
                          color: fg,
                          borderRadius: 10, fontSize: 12,
                          textDecoration: "none", cursor: "pointer",
                          maxWidth: "100%",
                        }}
                      >
                        <Paperclip size={12} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.attachment_name}</span>
                      </button>
                    )}
                  </div>
                </div>
                {(mine || !isGroupHead) && (
                  <div className="tertiary" style={{ fontSize: 10, marginTop: 4, textAlign: align === "flex-end" ? "right" : "left", marginLeft: !mine ? 44 : 0 }}>
                    {mine ? fmtTs(m.created_at) : fmtTimeShort(m.created_at)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {err && <div className="alert alert-risk" style={{ margin: 16 }}>{err}</div>}
      <form onSubmit={send} style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, borderTop: "1px solid var(--border-default)", background: "var(--bg-card)" }}>
        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }} data-testid="chat-attach">
          <Paperclip size={14} />
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && onAttach(e.target.files[0])} />
        </label>
        <input
          className="input"
          style={{ flex: 1, height: 38, borderRadius: 19, paddingLeft: 16 }}
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          data-testid="chat-input"
        />
        <button type="submit" className="btn btn-primary btn-sm" style={{ borderRadius: 19, padding: "8px 14px" }} disabled={busy || !text.trim()} data-testid="chat-send">
          <Send size={12} />
        </button>
      </form>
    </div>
  );
}

export default function MessagesPage() {
  const [eid, setEid] = useState(null);
  const [cpa, setCpa] = useState(null);
  const [err, setErr] = useState("");
  const ctx = useOutletContext();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/engagements");
        if (data[0]) {
          setEid(data[0].id);
          setCpa(data[0].assigned_cpa);
        }
      } catch (e) { setErr(fmtError(e)); }
    })();
  }, []);

  return (
    <div className="page-narrow" style={{ paddingTop: 32 }}>
      <h1 className="page-title" style={{ marginBottom: 24 }}>Messages</h1>
      {err && <div className="alert alert-risk">{err}</div>}
      {eid && (
        <ChatThread
          engagementId={eid}
          headerUser={cpa ? { name: cpa.name, subtitle: "Your tax professional" } : null}
          mineRightAlign={true}
          mineColor="blue"
          height={"calc(100vh - 240px)"}
          onUnreadChange={ctx?.refreshUnread}
        />
      )}
      {!eid && <div className="card muted">No active engagement yet.</div>}
    </div>
  );
}
