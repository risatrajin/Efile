import React from "react";
import { X, Type, ZoomIn, Contrast, Link as LinkIcon, Minus, Plus, MousePointer2, RotateCcw, Underline } from "lucide-react";
import { useA11y } from "../../contexts/AccessibilityContext";

const STEPS = [80, 90, 100, 110, 125, 150];

export default function AccessibilityPanel({ onClose }) {
  const a = useA11y();
  const stepIdx = (val) => Math.max(0, STEPS.indexOf(val));
  const adjust = (key, delta) => {
    const idx = stepIdx(a[key]);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, idx + delta))];
    a.set({ [key]: next });
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="a11y-panel">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="flex items-center between" style={{ marginBottom: 6 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Accessibility</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} data-testid="a11y-close" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Adjust text size, contrast, zoom and link visibility. Settings apply across all pages and persist on this device.</p>

        <Stepper
          icon={<Type size={16} />}
          label="Text size"
          value={`${a.textSize}%`}
          onMinus={() => adjust("textSize", -1)}
          onPlus={() => adjust("textSize", +1)}
          minus="a11y-text-minus"
          plus="a11y-text-plus"
        />
        <Stepper
          icon={<ZoomIn size={16} />}
          label="Page zoom"
          value={`${a.zoom}%`}
          onMinus={() => adjust("zoom", -1)}
          onPlus={() => adjust("zoom", +1)}
          minus="a11y-zoom-minus"
          plus="a11y-zoom-plus"
        />

        <Toggle icon={<Contrast size={16} />} label="High contrast" testid="a11y-contrast" value={a.highContrast} onChange={(v) => a.set({ highContrast: v })} />
        <Toggle icon={<LinkIcon size={16} />} label="Highlight links" testid="a11y-highlight" value={a.highlightLinks} onChange={(v) => a.set({ highlightLinks: v })} />
        <Toggle icon={<Underline size={16} />} label="Underline links" testid="a11y-underline" value={a.underlineLinks} onChange={(v) => a.set({ underlineLinks: v })} />
        <Toggle icon={<MousePointer2 size={16} />} label="Bigger cursor" testid="a11y-cursor" value={a.bigCursor} onChange={(v) => a.set({ bigCursor: v })} />
        <Toggle icon={<RotateCcw size={16} />} label="Reduce motion" testid="a11y-motion" value={a.reduceMotion} onChange={(v) => a.set({ reduceMotion: v })} />

        <div className="flex" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={a.reset} data-testid="a11y-reset"><RotateCcw size={12} /> Reset to defaults</button>
        </div>
      </div>
    </div>
  );
}

function Row({ children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border-default)" }}>{children}</div>;
}

function Stepper({ icon, label, value, onMinus, onPlus, minus, plus }) {
  return (
    <Row>
      <div style={{ width: 28, color: "var(--text-secondary)" }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</div>
      <div className="flex items-center gap-2">
        <button className="btn btn-secondary btn-sm" onClick={onMinus} data-testid={minus} aria-label={`Decrease ${label}`}><Minus size={12} /></button>
        <span style={{ minWidth: 48, textAlign: "center", fontSize: 13, fontWeight: 600 }}>{value}</span>
        <button className="btn btn-secondary btn-sm" onClick={onPlus} data-testid={plus} aria-label={`Increase ${label}`}><Plus size={12} /></button>
      </div>
    </Row>
  );
}

function Toggle({ icon, label, value, onChange, testid }) {
  return (
    <Row>
      <div style={{ width: 28, color: "var(--text-secondary)" }}>{icon}</div>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{label}</div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        data-testid={testid}
        style={{
          width: 38, height: 22, borderRadius: 999, position: "relative",
          background: value ? "var(--accent-dark)" : "#d9d5cf",
          transition: "background-color 120ms ease",
          cursor: "pointer",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: value ? 18 : 2,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          transition: "left 120ms ease", boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
        }} />
      </button>
    </Row>
  );
}
