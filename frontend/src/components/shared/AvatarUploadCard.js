import React, { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { api, fmtError } from "../../lib/api";
import UserAvatar from "./UserAvatar";

/**
 * Reusable profile-picture upload section. Shared by /account and /admin/settings.
 *
 * Props:
 *  - me: current user object (has avatar_url when set)
 *  - onChange(nextUser): called after upload/delete with the patched user object
 */
export default function AvatarUploadCard({ me, onChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onPick = () => { inputRef.current?.click(); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      setErr("Please select an image file (PNG, JPEG, WebP or GIF).");
      e.target.value = "";
      return;
    }
    setErr(""); setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post("/users/me/avatar", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Backend returns a versioned avatar_url so URL changes per upload.
      onChange?.({ ...me, avatar_url: data.avatar_url });
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setErr(""); setBusy(true);
    try {
      await api.delete("/users/me/avatar");
      const next = { ...me };
      delete next.avatar_url;
      onChange?.(next);
    } catch (x) {
      setErr(fmtError(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" data-testid="avatar-upload-card">
      <div className="section-label" style={{ marginBottom: 16 }}>PROFILE PICTURE</div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <UserAvatar user={me} size={80} testid="avatar-upload-preview" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{me.name}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            PNG, JPEG, WebP or GIF · max 4 MB. We&apos;ll use a colourful initials avatar if none is set.
          </div>
          <div className="flex gap-2 mt-3">
            <button
              className="btn btn-primary btn-sm"
              onClick={onPick}
              disabled={busy}
              data-testid="avatar-upload-btn"
            >
              <Camera size={12} /> {me.avatar_url ? "Change photo" : "Upload photo"}
            </button>
            {me.avatar_url && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={onRemove}
                disabled={busy}
                data-testid="avatar-remove-btn"
              >
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          {err && <div className="alert alert-risk mt-2" data-testid="avatar-upload-err">{err}</div>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onFile}
        style={{ display: "none" }}
        data-testid="avatar-upload-input"
      />
    </div>
  );
}
