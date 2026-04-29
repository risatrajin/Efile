import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Lock, CheckCircle2 } from "lucide-react";

const STAGES = [
  { key: "REFERRED", label: "Referred", description: "Awaiting CPA assignment" },
  { key: "INTAKE", label: "Intake", description: "Client uploading documents" },
  { key: "IN_PREP", label: "In Prep", description: "CPA preparing return" },
  { key: "IN_REVIEW", label: "Review", description: "Client reviewing draft" },
  // FILED is intentionally NOT a Move-to option. The only path to FILED is the
  // CPA's "Update submission info" form (POST /engagements/{eid}/file-with-cra),
  // which atomically captures the CRA confirmation, filing summary, and PDF copy.
];

const STAGE_INDEX = STAGES.reduce((acc, s, i) => { acc[s.key] = i; return acc; }, {});

export default function MoveToDropdown({ current, onChange, disabledKeys = [], note, testid = "move-to-dropdown" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const isFiled = current === "FILED";
  const currentLabel = isFiled
    ? "Filed"
    : (STAGES.find((s) => s.key === current)?.label || current);
  const currentIdx = STAGE_INDEX[current] ?? -1;

  const select = (key) => {
    if (key === current || disabledKeys.includes(key)) return;
    setOpen(false);
    onChange?.(key);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid={testid}
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "8px 14px", borderRadius: 8,
          background: "#fff", border: "1px solid var(--border-default)",
          fontSize: 13, fontWeight: 500, color: "var(--text-primary)",
          transition: "background-color 120ms ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {isFiled ? (
            <CheckCircle2 size={14} style={{ color: "#1565c0" }} strokeWidth={2.5} />
          ) : (
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#1565c0" }} />
          )}
          Step: {currentLabel}
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div data-testid={`${testid}-menu`} style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)",
          background: "#fff", border: "1px solid var(--border-default)", borderRadius: 12,
          minWidth: 300, padding: 6,
          boxShadow: "0 12px 32px rgba(0,0,0,0.10)", zIndex: 30,
        }}>
          {isFiled && (
            <div
              data-testid={`${testid}-filed-banner`}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "12px 12px 12px 12px",
                background: "#e3f2fd",
                border: "1px solid #bbdefb",
                borderRadius: 10,
                margin: "6px 6px 8px",
              }}
            >
              <CheckCircle2 size={16} style={{ color: "#1565c0", flexShrink: 0, marginTop: 1 }} strokeWidth={2.5} />
              <div style={{ fontSize: 12, lineHeight: 1.5, color: "#0d47a1" }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Already filed with CRA.</div>
                Move back only to apply corrections — filing data is preserved.
              </div>
            </div>
          )}
          <div className="section-label" style={{ padding: "10px 12px 6px" }}>
            {isFiled ? "ROLL BACK TO" : "MOVE TO STEP"}
          </div>
          {STAGES.map((s, i) => {
            const isCurrent = !isFiled && s.key === current;
            const isPast = !isFiled && i < currentIdx;
            const disabled = disabledKeys.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => select(s.key)}
                disabled={isCurrent || disabled}
                data-testid={`${testid}-${s.key}`}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  background: isCurrent ? "#e3f2fd" : "transparent",
                  cursor: (isCurrent || disabled) ? "default" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                  textAlign: "left",
                  transition: "background-color 120ms ease",
                }}
                onMouseEnter={(e) => { if (!isCurrent && !disabled) e.currentTarget.style.background = "var(--bg-subtle)"; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                  border: `2px solid ${isCurrent ? "#1565c0" : isPast ? "#1565c0" : "#d9d5cf"}`,
                  background: isPast || isCurrent ? "#1565c0" : "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginTop: 1,
                }}>
                  {(isCurrent || isPast) && <Check size={10} style={{ color: "#fff" }} strokeWidth={3} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                    {s.label}
                    {isCurrent && <span style={{ fontSize: 10, fontWeight: 600, background: "#1565c0", color: "#fff", padding: "1px 8px", borderRadius: 999, letterSpacing: 0.4 }}>CURRENT</span>}
                    {disabled && <Lock size={10} style={{ color: "var(--text-tertiary)" }} />}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.description}</div>
                </div>
              </button>
            );
          })}
          {note && !isFiled && (
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border-default)", marginTop: 4 }}>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>{note}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
