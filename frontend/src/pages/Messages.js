import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOutletContext } from "react-router-dom";
import { api, fmtError, initials } from "../lib/api";
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
    } catch { /* ignore */ }
  }, [engagementId, onUnreadChange]);

  useEffect(() => { if (!engagementId) return; setErr(""); load().then(markRead); }, [engagementId, load, markRead]);

  // SSE
  useEffect(() => {
    if (!engagementId) return;
    const token = localStorage.getItem("ct_token");
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
      } catch { /* ignore */ }
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
        {msgs.map((m) => {
          const mine = m.sender?.id === user?.id;
          const align = mine ? (mineRightAlign ? "flex-end" : "flex-start") : (mineRightAlign ? "flex-start" : "flex-end");
          const bg = mine ? myColor : "#ebe7e0";
          const fg = mine ? "#fff" : "var(--text-primary)";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: align, marginBottom: 12 }} data-testid={`msg-${m.id}`}>
              <div style={{ maxWidth: "70%" }}>
                <div className="flex items-center gap-2" style={{ flexDirection: align === "flex-end" ? "row-reverse" : "row", marginBottom: 4 }}>
                  {!mine && <div className="avatar avatar-sm">{initials(m.sender?.name || "")}</div>}
                </div>
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
                <div className="tertiary" style={{ fontSize: 10, marginTop: 4, textAlign: align === "flex-end" ? "right" : "left" }}>{fmtTs(m.created_at)}</div>
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
