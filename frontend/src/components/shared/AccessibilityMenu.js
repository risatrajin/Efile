import React, { useEffect, useRef, useState } from "react";
import {
  Accessibility, Type, ZoomIn, Contrast, Link as LinkIcon, Minus, Plus,
  MousePointer2, RotateCcw, Underline,
} from "lucide-react";
import { useA11y } from "../../contexts/AccessibilityContext";

const STEPS = [80, 90, 100, 110, 125, 150];

/**
 * Dropdown-style accessibility menu anchored to an icon button in the AppHeader.
 * Replaces the previous full-screen modal panel — same controls, more compact.
 */
export default function AccessibilityMenu() {
  const a = useA11y();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const stepIdx = (val) => Math.max(0, STEPS.indexOf(val));
  const adjust = (key, delta) => {
    const idx = stepIdx(a[key]);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + delta))];
    a.set({ [key]: next });
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        data-testid="header-accessibility"
        title="Accessibility"
        aria-label="Open accessibility settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 36, height: 36, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 120ms ease",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <Accessibility size={18} />
      </button>
      {open && (
        <div
          data-testid="a11y-menu"
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 10px)", right: 0,
            background: "#fff", border: "1px solid var(--border-default)", borderRadius: 14,
            width: 320, padding: 12,
            boxShadow: "0 16px 48px rgba(0,0,0,0.12)", zIndex: 50,
          }}
        >
          <div style={{ padding: "4px 8px 8px", borderBottom: "1px solid var(--border-default)", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Accessibility</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Settings persist on this device.</div>
          </div>

          <Stepper
            icon={<Type size={14} />}
            label="Text size"
            value={`${a.textSize}%`}
            onMinus={() => adjust("textSize", -1)}
            onPlus={() => adjust("textSize", +1)}
            minus="a11y-text-minus"
            plus="a11y-text-plus"
          />
          <Stepper
            icon={<ZoomIn size={14} />}
            label="Page zoom"
            value={`${a.zoom}%`}
            onMinus={() => adjust("zoom", -1)}
            onPlus={() => adjust("zoom", +1)}
            minus="a11y-zoom-minus"
            plus="a11y-zoom-plus"
          />
          <Toggle icon={<Contrast size={14} />}      label="High contrast"   testid="a11y-contrast"  value={a.highContrast}   onChange={(v) => a.set({ highContrast: v })} />
          <Toggle icon={<LinkIcon size={14} />}      label="Highlight links" testid="a11y-highlight" value={a.highlightLinks} onChange={(v) => a.set({ highlightLinks: v })} />
          <Toggle icon={<Underline size={14} />}     label="Underline links" testid="a11y-underline" value={a.underlineLinks} onChange={(v) => a.set({ underlineLinks: v })} />
          <Toggle icon={<MousePointer2 size={14} />} label="Bigger cursor"   testid="a11y-cursor"    value={a.bigCursor}      onChange={(v) => a.set({ bigCursor: v })} />
          <Toggle icon={<RotateCcw size={14} />}     label="Reduce motion"   testid="a11y-motion"    value={a.reduceMotion}   onChange={(v) => a.set({ reduceMotion: v })} />

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-default)" }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => a.reset()}
              data-testid="a11y-reset"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 8px",
      borderRadius: 8,
    }}>
      {children}
    </div>
  );
}

function Stepper({ icon, label, value, onMinus, onPlus, minus, plus }) {
  return (
    <Row>
      <div style={{ width: 22, color: "var(--text-secondary)", display: "inline-flex" }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={onMinus}
          data-testid={minus}
          aria-label={`Decrease ${label}`}
          style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border-default)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        ><Minus size={11} /></button>
        <span style={{ minWidth: 40, textAlign: "center", fontSize: 12, fontWeight: 600 }}>{value}</span>
        <button
          onClick={onPlus}
          data-testid={plus}
          aria-label={`Increase ${label}`}
          style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--border-default)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        ><Plus size={11} /></button>
      </div>
    </Row>
  );
}

function Toggle({ icon, label, value, onChange, testid }) {
  return (
    <Row>
      <div style={{ width: 22, color: "var(--text-secondary)", display: "inline-flex" }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>{label}</div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        data-testid={testid}
        style={{
          width: 34, height: 20, borderRadius: 999, position: "relative",
          background: value ? "var(--accent-dark)" : "#d9d5cf",
          transition: "background-color 120ms ease",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: value ? 16 : 2,
          width: 16, height: 16, borderRadius: "50%", background: "#fff",
          transition: "left 120ms ease", boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
        }} />
      </button>
    </Row>
  );
}
