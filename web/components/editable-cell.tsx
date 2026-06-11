"use client";

import { useState } from "react";

/**
 * Click-to-edit cell: a button until clicked, then an input that commits on
 * Enter/blur and cancels on Escape. `label` names the field for a11y/tests,
 * e.g. "notes for Chick-fil-A".
 */
export function EditableCell({
  value,
  display,
  label,
  type = "text",
  listId,
  align = "left",
  onCommit,
}: {
  value: string;
  display?: React.ReactNode;
  label: string;
  type?: "text" | "date" | "number";
  listId?: string;
  align?: "left" | "right";
  onCommit: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        className={`w-full rounded px-1 py-0.5 text-${align} hover:bg-blush-100/40 focus:outline-none focus:ring-2 focus:ring-blush-600/40`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {display ?? (value || <span className="text-stone-300">—</span>)}
      </button>
    );
  }

  const commit = async () => {
    setEditing(false);
    if (draft !== value) {
      await onCommit(draft);
    }
  };

  return (
    <input
      autoFocus
      aria-label={label}
      type={type}
      step={type === "number" ? "0.01" : undefined}
      list={listId}
      value={draft}
      className={`w-full rounded border border-blush-600 bg-white px-1 py-0.5 text-${align} outline-none`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}
