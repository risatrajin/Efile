import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";

/**
 * Header bubble that shows the unread-message count and routes the user to
 * their messages page. Iter 30 (msg #768 item 12): clients also navigate to a
 * page now (was a popover) so the experience is consistent with the
 * "Message" button on the client portal's CPA card.
 */
export default function MessagesInboxButton() {
  const [unreadTotal, setUnreadTotal] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();

  const isStaff = user?.role === "ADMIN" || user?.role === "CPA";
  const targetPath = user?.role === "ADMIN"
    ? "/admin/messages"
    : user?.role === "CPA"
      ? "/cpa/messages"
      : "/portal/messages";

  const load = async () => {
    try {
      const { data } = await api.get("/messages/inbox");
      setUnreadTotal((data || []).reduce((s, r) => s + (r.unread_count || 0), 0));
    } catch (e) {
      // Non-fatal — surfaced errors live on the page itself.
      console.warn("Inbox load failed:", e);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, isStaff ? 60000 : 30000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, [isStaff]);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => navigate(targetPath)}
        data-testid="header-messages-icon"
        title="Messages"
        aria-label="Open messages"
        style={{
          position: "relative", width: 36, height: 36, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 120ms ease",
          background: "transparent", border: "none", cursor: "pointer",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-subtle)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
      >
        <MessageSquare size={18} style={{ color: "var(--text-primary)" }} />
        {unreadTotal > 0 && (
          <span
            data-testid="messages-badge"
            style={{
              position: "absolute", top: 4, right: 4, minWidth: 16, height: 16,
              padding: "0 4px", borderRadius: 999, background: "#1565c0", color: "#fff",
              fontSize: 10, fontWeight: 600, display: "inline-flex",
              alignItems: "center", justifyContent: "center", lineHeight: 1,
            }}
          >{unreadTotal > 9 ? "9+" : unreadTotal}</span>
        )}
      </button>
    </div>
  );
}
