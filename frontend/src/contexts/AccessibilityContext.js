import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";

/**
 * Global accessibility state. Persisted to localStorage and applied to
 * <html> via class names + CSS variables so any page picks them up
 * automatically (see /app/frontend/src/index.css ".a11y-*" rules).
 */
const A11yContext = createContext(null);

const STORAGE_KEY = "cloudtax.a11y";

const DEFAULTS = {
  textSize: 100,         // 80 / 90 / 100 / 110 / 125 / 150 (%)
  zoom: 100,             // 80 / 90 / 100 / 110 / 125 / 150 (%)
  highContrast: false,
  highlightLinks: false,
  reduceMotion: false,
  bigCursor: false,
  underlineLinks: false,
};

export function AccessibilityProvider({ children }) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch { return { ...DEFAULTS }; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
    const root = document.documentElement;
    root.style.setProperty("--a11y-text-scale", state.textSize / 100);
    root.style.zoom = state.zoom !== 100 ? `${state.zoom}%` : "";
    // The app uses px (not rem) for nearly every text style, so scaling the html
    // font-size has no visible effect. Apply text-size as a `zoom` on <body>
    // (independent of page-zoom on <html>) so px-based fonts actually scale.
    if (document.body) {
      document.body.style.zoom = state.textSize !== 100 ? `${state.textSize}%` : "";
    }
    root.classList.toggle("a11y-high-contrast", !!state.highContrast);
    root.classList.toggle("a11y-highlight-links", !!state.highlightLinks);
    root.classList.toggle("a11y-reduce-motion", !!state.reduceMotion);
    root.classList.toggle("a11y-big-cursor", !!state.bigCursor);
    root.classList.toggle("a11y-underline-links", !!state.underlineLinks);
  }, [state]);

  const set = useCallback((patch) => setState((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setState({ ...DEFAULTS }), []);

  // Memoise so consumers don't re-render on parent renders.
  const value = useMemo(() => ({ ...state, set, reset }), [state, set, reset]);

  return (
    <A11yContext.Provider value={value}>
      {children}
    </A11yContext.Provider>
  );
}

export function useA11y() {
  const ctx = useContext(A11yContext);
  if (!ctx) throw new Error("useA11y must be used inside <AccessibilityProvider>");
  return ctx;
}
