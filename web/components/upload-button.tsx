"use client";

import { useRef, useState } from "react";

export function UploadButton({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setStatus("Uploading…");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Upload failed");
        return;
      }
      const match = body.validation?.match
        ? "validation matched"
        : "⚠ validation mismatch — check the imported rows";
      setStatus(`Imported ${body.transactionCount} transactions (${match}).`);
      onUploaded();
    } catch (error) {
      setStatus(`Upload failed: ${String(error)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      {status && <p className="max-w-xs text-right text-xs text-stone-500">{status}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        aria-label="Statement PDF"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        disabled={busy}
        className="rounded-lg bg-blush-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blush-800 disabled:opacity-50"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Importing…" : "Upload statement"}
      </button>
    </div>
  );
}
