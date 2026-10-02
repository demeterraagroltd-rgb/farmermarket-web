"use client";

import { useState } from "react";
import { apiFetch } from "../../lib/auth";

export function CatalogImageInput({ value, onChange, onBusyChange, required = false }: {
  value: string; onChange: (url: string) => void; onBusyChange: (busy: boolean) => void; required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Choose a PNG, JPEG, or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("Choose an image smaller than 5 MB."); return; }
    setUploading(true); onBusyChange(true);
    try {
      const body = new FormData(); body.append("file", file);
      const res = await apiFetch("/v1/admin/catalog/images", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Image upload failed.");
      onChange(data.imageUrl);
    } catch (err) { setError(err instanceof Error ? err.message : "Image upload failed. Try again."); }
    finally { setUploading(false); onBusyChange(false); }
  }
  return <div>
    <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted">Image{required ? " *" : ""}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} className="mt-2 block w-full rounded-lg border border-dark-border/60 p-2 text-sm font-normal normal-case file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-white" />
    </label>
    {value && <><p className="mt-2 text-xs text-text-muted">Current image</p>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={value} alt="Selected catalog image" className="mt-1 h-24 w-32 rounded-lg border border-dark-border/30 object-contain" /></>}
    <p className="mt-2 text-xs text-text-muted" role="status">{uploading ? "Uploading image…" : "PNG, JPEG or WebP. Maximum 5 MB. Save the form to apply the image."}</p>
    {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
  </div>;
}
