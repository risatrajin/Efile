import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Password input with a built-in show/hide eye toggle.
 *
 * Mirrors the visual + a11y behaviour used on the Login page so every password
 * field across the app has the same affordance.
 */
export default function PasswordField({ value, onChange, placeholder, testid, autoFocus, required = true, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        data-testid={testid}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        data-testid={testid ? `${testid}-toggle` : undefined}
        style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          width: 30, height: 30, borderRadius: 6,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-tertiary)", background: "transparent", border: "none",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
