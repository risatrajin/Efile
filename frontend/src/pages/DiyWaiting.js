import React from "react";
import { Link, useParams } from "react-router-dom";

// Placeholder destination while DIY_ENGINE_URL is unset. Once the filing
// engine ships, the handoff button links straight to the engine and this
// page becomes unreachable — swapping is a one-env-var change server-side.
export default function DiyWaiting() {
  const { eid } = useParams();
  return (
    <div className="page-narrow stack-lg" style={{ paddingTop: 32 }} data-testid="diy-waiting">
      <div className="card">
        <h2 className="section-title">Almost there</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          We&apos;re preparing your self-serve filing experience. You&apos;ll get an email when it&apos;s ready.
        </p>
        <Link to={`/portal/filing/${eid}`} className="link-underline" style={{ fontSize: 13, marginTop: 12, display: "inline-block" }}>
          Back
        </Link>
      </div>
    </div>
  );
}
