import React, { useEffect, useRef, useState } from "react";
import { X, Eraser } from "lucide-react";

/**
 * Modal with a HTML5 canvas signature pad. Captures the signature as a
 * data URL (image/png) and a typed name, then calls onSign({ signature, name }).
 *
 * Used in Client Portal Tax Summary to sign the CRA T183 form.
 */
export default function SignaturePadModal({ defaultName = "", onClose, onSubmit, busy }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");

  // Prepare canvas at high DPR for crisp lines
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1a1a1a";
  }, []);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const t = e.touches?.[0];
    return { x: (t ? t.clientX : e.clientX) - r.left, y: (t ? t.clientY : e.clientY) - r.top };
  };

  const start = (e) => { e.preventDefault(); const { x, y } = pos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x, y); setDrawing(true); };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const { x, y } = pos(e); const ctx = canvasRef.current.getContext("2d"); ctx.lineTo(x, y); ctx.stroke(); setHasInk(true); };
  const end = () => setDrawing(false);

  const clear = () => {
    const c = canvasRef.current; const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height); setHasInk(false);
  };

  const submit = async () => {
    setError("");
    if (!name.trim()) { setError("Please type your full legal name."); return; }
    if (!hasInk) { setError("Please draw your signature in the pad."); return; }
    const dataUrl = canvasRef.current.toDataURL("image/png");
    await onSubmit({ signature: dataUrl, name: name.trim() });
  };

  return (
    <div className="modal-overlay" onClick={onClose} data-testid="t183-sign-modal">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="flex items-center between" style={{ marginBottom: 4 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Sign T183 — Authorization to file electronically</h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm" data-testid="t183-close" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          By signing below you authorize your CPA to electronically file your corporate return with the CRA. Your signature is legally binding.
        </p>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="field-label">Full legal name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rachel Thompson"
            data-testid="t183-name"
          />
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="field-label">Draw your signature</label>
          <div style={{ position: "relative" }}>
            <canvas
              ref={canvasRef}
              data-testid="t183-canvas"
              style={{ width: "100%", height: 180, border: "1px solid var(--border-default)", borderRadius: 10, background: "#fafafa", touchAction: "none", cursor: "crosshair" }}
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
            />
            <button onClick={clear} className="btn btn-ghost btn-sm" data-testid="t183-clear" style={{ position: "absolute", top: 8, right: 8 }} disabled={!hasInk}>
              <Eraser size={12} /> Clear
            </button>
          </div>
        </div>

        {error && <div className="alert alert-risk" style={{ marginTop: 10, fontSize: 12 }}>{error}</div>}

        <div className="flex gap-2" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm" data-testid="t183-cancel">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn btn-primary btn-sm" data-testid="t183-submit">
            {busy ? "Submitting…" : "Sign and submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
