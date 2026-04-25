import React, { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";

/** Wrapper that the 3 client routes (/portal, /portal/messages, /portal/account) share.
 *  Provides nav with Messages unread-count badge, refreshed on route change.
 */
export default function ClientLayout() {
  const [unread, setUnread] = useState(0);
  const [eid, setEid] = useState(null);
  const location = useLocation();

  const refresh = async () => {
    try {
      if (!eid) {
        const { data: list } = await api.get("/engagements");
        if (list[0]) setEid(list[0].id);
        if (!list[0]) return;
        const { data: u } = await api.get(`/engagements/${list[0].id}/messages/unread-count`);
        setUnread(u.count);
      } else {
        const { data: u } = await api.get(`/engagements/${eid}/messages/unread-count`);
        setUnread(u.count);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [location.pathname]);
  useEffect(() => {
    const i = setInterval(refresh, 30000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, [eid]);

  const tabs = [
    { key: "dashboard", to: "/portal", label: "Dashboard", matcher: (p) => p === "/portal" || p === "/portal/" },
    { key: "messages", to: "/portal/messages", label: "Messages" },
    { key: "account", to: "/portal/account", label: "Account" },
  ];

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} unreadByKey={{ messages: unread }} />
      <Outlet context={{ refreshUnread: refresh }} />
    </div>
  );
}
