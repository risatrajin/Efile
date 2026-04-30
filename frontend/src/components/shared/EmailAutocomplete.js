import React, { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import UserAvatar from "./UserAvatar";

// Highlight matched substring (case-insensitive).
function Highlighted({ text, query }) {
  if (!text || !query) return <>{text}</>;
  const lc = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lc.indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "#fff59d", color: "inherit", padding: 0 }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function StatusBadge({ status }) {
  const map = {
    active:  { bg: "#e8f5e9", fg: "#1b5e20", label: "Active" },
    invited: { bg: "#fff8e1", fg: "#ff8f00", label: "Invited" },
    removed: { bg: "#fdecea", fg: "#b71c1c", label: "Removed" },
  };
  const m = map[status] || { bg: "#eceff1", fg: "#455a64", label: status || "—" };
  return (
    <span
      data-testid={`email-suggestion-status-${status}`}
      style={{
        background: m.bg, color: m.fg, fontSize: 10, fontWeight: 600,
        padding: "2px 8px", borderRadius: 999, textTransform: "uppercase",
        letterSpacing: 0.3, whiteSpace: "nowrap",
      }}
    >{m.label}</span>
  );
}

/**
 * Controlled email input with typeahead suggestions from /api/users/search.
 *
 * Props:
 *   value, onChange(email) — controlled input value
 *   onSelect(user)         — fires when a suggestion is picked (the whole row)
 *   disabled, placeholder, testid
 */
export default function EmailAutocomplete({
  value, onChange, onSelect,
  disabled = false, placeholder = "email@example.com", testid = "email-autocomplete",
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const abortRef = useRef(null);

  // Debounced fetch — only run after 2+ chars.
  useEffect(() => {
    const q = (value || "").trim();
    if (q.length < 2) {
      setResults([]); setOpen(false); setActive(-1);
      return;
    }
    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      try {
        const { data } = await api.get("/users/search", { params: { q, limit: 8 }, signal: ctl.signal });
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
        setActive(-1);
      } catch (_) {
        // Request cancelled or failed — keep last results
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (row) => {
    onChange(row.email || "");
    onSelect?.(row);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false); setActive(-1);
    }
  };

  const q = (value || "").trim();

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="email"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => q.length >= 2 && results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        data-testid={testid}
      />
      {open && (loading || results.length > 0) && (
        <div
          data-testid={`${testid}-dropdown`}
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "#fff", border: "1px solid var(--border-default)",
            borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
            zIndex: 2000, maxHeight: 320, overflowY: "auto",
          }}
        >
          {loading && results.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>Searching…</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(r); }}
              onMouseEnter={() => setActive(i)}
              data-testid={`${testid}-item-${i}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "10px 12px", textAlign: "left",
                background: i === active ? "#f3f4f6" : "transparent",
                border: "none", borderBottom: "1px solid var(--border-subtle)",
                cursor: "pointer",
              }}
            >
              <UserAvatar user={{ name: r.name, email: r.email, avatar_url: r.avatar_url }} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <Highlighted text={r.email} query={q} />
                </div>
                {r.name && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Highlighted text={r.name} query={q} />
                    {r.display_role && <span style={{ marginLeft: 6 }}>· {r.display_role}</span>}
                  </div>
                )}
              </div>
              <StatusBadge status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
