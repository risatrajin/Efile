/**
 * Returns the vendor-host marker substring if ``url`` looks like a
 * preview / vendor-hosted URL rather than the customer-facing production
 * URL. Kept in sync with the backend's ``_VENDOR_HOST_MARKERS`` check in
 * ``server.py``. Returns ``null`` if the URL is clean.
 *
 * Used by admin "copy invite link" boxes to refuse to display a preview
 * URL that would leak vendor branding to a client if the admin forwards it.
 */
const VENDOR_MARKERS = ["emergent", "preview.", "localhost", "127.0.0.1", "0.0.0.0", ".onrender.com", ".vercel.app"];

export function vendorLeakMarker(url) {
  if (!url || typeof url !== "string") return null;
  const lower = url.toLowerCase();
  for (const m of VENDOR_MARKERS) {
    if (lower.includes(m)) return m;
  }
  return null;
}

export function isVendorLeak(url) {
  return !!vendorLeakMarker(url);
}
