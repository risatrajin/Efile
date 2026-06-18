import React, { useEffect, useState } from "react";
import { api, fmtError } from "../../lib/api";
import { Send, Clock } from "lucide-react";

const ROLE_LABEL = {
  PARTNER: "Partner",
  CPA: "CPA",
  ADMIN: "Admin",
  CLIENT: "Client",
};

const ROLE_BG = {
  PARTNER: "#e3f2fd",
  CPA: "#e8f5e9",
  ADMIN: "#fff8e1",
};

function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Free-form engagement notes feed shared across WS / CPA / Admin portals.
 *
 * Newest entries are surfaced at the top (item 2 of msg #768): when a partner
 * adds a note, it appears immediately above the input field. The feed is
 * append-only; legacy ``partner_notes`` strings are surfaced as a single
 * read-only entry at the bottom so historical context is never lost.
 */
export default function EngagementNotes({ eid, title = "Tax situation / Notes", placeholder = "Add a note (background, planning context, special considerations)…" }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/engagements/${eid}/notes`);
      setItems(data.items || []);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [eid]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/engagements/${eid}/notes`, { text });
      setItems(data.items || []);
      setDraft("");
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    // ⌘/Ctrl+Enter sends — matches the messaging UX elsewhere in the app.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="card" data-testid="engagement-notes">
      <h2 className="card-title" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</h2>
      <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>Visible to the partner, the assigned CPA, and Admins. Not visible to clients.</p>

      {/* Compose — sits ABOVE the feed so the newest note is saved at the top of the list. */}
      <div style={{
        background: "var(--bg-subtle)", border: "1px solid var(--border-default)",
        borderRadius: 10, padding: 12, marginBottom: 14,
      }}>
        <textarea
          className="textarea"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          data-testid="engagement-notes-input"
          style={{ background: "#fff" }}
        />
        <div className="flex items-center between" style={{ marginTop: 8 }}>
          <span className="tertiary" style={{ fontSize: 11 }}>⌘+Enter to add</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={busy || !draft.trim()}
            data-testid="engagement-notes-add"
          ><Send size={12} /> {busy ? "Adding…" : "Add note"}</button>
        </div>
      </div>

      {err && <div className="alert alert-risk" style={{ marginBottom: 10, fontSize: 12 }} data-testid="engagement-notes-err">{err}</div>}

      {loading && items.length === 0 && (
        <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: 16 }}>Loading…</div>
      )}
      {!loading && items.length === 0 && (
        <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: 16, fontStyle: "italic" }} data-testid="engagement-notes-empty">
          No notes yet. Add the first one above.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((n) => (
          <div
            key={n.id}
            data-testid={`engagement-note-${n.id}`}
            style={{
              background: ROLE_BG[n.author_role] || "#fafafa",
              borderRadius: 10,
              padding: "12px 14px",
              border: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-center between" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {n.author_name || "—"}
                {n.author_role && (
                  <span className="muted" style={{ fontSize: 11, fontWeight: 500, marginLeft: 6 }}>
                    · {ROLE_LABEL[n.author_role] || n.author_role}
                  </span>
                )}
                {n.is_legacy && (
                  <span style={{ fontSize: 9, fontWeight: 600, marginLeft: 8, padding: "1px 6px", borderRadius: 999, background: "#eee", color: "#777" }}>LEGACY</span>
                )}
              </span>
              <span className="tertiary" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} /> {timeAgo(n.at)}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
