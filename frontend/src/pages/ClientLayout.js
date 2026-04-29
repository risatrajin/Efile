import React from "react";
import { Outlet } from "react-router-dom";
import AppHeader from "../components/shared/AppHeader";

/** Wrapper for the 3 client routes (/portal, /portal/messages, /portal/account).
 *
 *  Note (iter 26): we no longer render the Dashboard / Messages / Account tab
 *  strip — every destination is reachable from the right-side header cluster
 *  (Home icon → /portal, Messages bubble → /portal/messages, Avatar dropdown
 *  → Account & Sign out). Keeping a duplicate menu cluttered the header.
 */
export default function ClientLayout() {
  return (
    <div className="app-root">
      <AppHeader />
      <Outlet />
    </div>
  );
}
