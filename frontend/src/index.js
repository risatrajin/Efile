import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress the harmless "ResizeObserver loop completed with undelivered notifications" overlay
// that CRA's react-error-overlay surfaces in development. This is a known browser quirk.
const RESIZE_OBSERVER_ERR_MSG = "ResizeObserver loop completed with undelivered notifications";
const RESIZE_OBSERVER_LIMIT_MSG = "ResizeObserver loop limit exceeded";

window.addEventListener("error", (e) => {
  const msg = e?.message || "";
  if (msg.includes(RESIZE_OBSERVER_ERR_MSG) || msg.includes(RESIZE_OBSERVER_LIMIT_MSG)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = (e?.reason && (e.reason.message || String(e.reason))) || "";
  if (msg.includes(RESIZE_OBSERVER_ERR_MSG) || msg.includes(RESIZE_OBSERVER_LIMIT_MSG)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
