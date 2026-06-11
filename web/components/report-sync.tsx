"use client";

import { useState } from "react";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ReportSync() {
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sync = async () => {
    setBusy(true);
    setStatus("Syncing…");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Sync failed");
        return;
      }
      setStatus(`Notion row ${body.action} for ${month}.`);
    } catch (error) {
      setStatus(`Sync failed: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          type="month"
          aria-label="Report month"
          className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800 shadow-sm outline-none focus:border-blush-600"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !month}
          className="rounded-lg border border-blush-700 px-3 py-1.5 text-sm font-medium text-blush-700 hover:bg-blush-100/40 disabled:opacity-50"
          onClick={() => void sync()}
        >
          {busy ? "Syncing…" : "Sync to Notion"}
        </button>
      </div>
      {status && <p className="text-xs text-stone-500">{status}</p>}
    </div>
  );
}
