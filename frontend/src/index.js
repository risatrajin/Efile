import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress the harmless "ResizeObserver loop completed with undelivered notifications"
// overlay that CRA's react-error-overlay surfaces in development. Registering with
// {capture:true} ensures we run BEFORE react-error-overlay's own listener so we can
// stop the event from reaching it. This is a well-documented browser quirk that
// ships in dev only — production builds don't have the overlay at all.
const RESIZE_OBSERVER_ERR_MSG = "ResizeObserver loop completed with undelivered notifications";
const RESIZE_OBSERVER_LIMIT_MSG = "ResizeObserver loop limit exceeded";

const isResizeObserverNoise = (msg) =>
  typeof msg === "string" && (msg.includes(RESIZE_OBSERVER_ERR_MSG) || msg.includes(RESIZE_OBSERVER_LIMIT_MSG));

window.addEventListener(
  "error",
  (e) => {
    if (isResizeObserverNoise(e?.message || "")) {
      e.stopImmediatePropagation();
      e.preventDefault();
      // Hide the dev overlay iframe if it has already appeared this tick.
      const iframe = document.body.querySelector("iframe");
      if (iframe && iframe.style && iframe.style.zIndex === "2147483647") {
        iframe.style.display = "none";
      }
    }
  },
  true,
);

window.addEventListener(
  "unhandledrejection",
  (e) => {
    const msg = (e?.reason && (e.reason.message || String(e.reason))) || "";
    if (isResizeObserverNoise(msg)) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  },
  true,
);

// react-error-overlay reads through console.error too; mute the same message there.
const _origConsoleError = window.console.error;
window.console.error = (...args) => {
  const first = args && args[0];
  if (isResizeObserverNoise(typeof first === "string" ? first : (first && first.message) || "")) {
    return;
  }
  _origConsoleError.apply(window.console, args);
};

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
