"use client";

import { useState } from "react";

import { CATEGORIES, sortCategoriesOtherLast } from "@/lib/openai";

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/**
 * Click-to-edit category cell with a real dropdown: every known category
 * (alphabetical, Other pinned last), a color dot per category — clicking the
 * dot opens a draft color editor (picker + hex) that only applies on Save —
 * and free-text entry for custom categories.
 */
export function CategoryPicker({
  value,
  merchant,
  colorFor,
  onSetColor,
  onCommit,
}: {
  value: string;
  merchant: string;
  colorFor: (category: string) => string;
  onSetColor: (category: string, color: string) => void;
  onCommit: (category: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [colorTarget, setColorTarget] = useState<string | null>(null);
  const [colorDraft, setColorDraft] = useState("#000000");
  const [hexText, setHexText] = useState("");

  const options = sortCategoriesOtherLast([...CATEGORIES, value]);

  const openColorEditor = (category: string) => {
    if (colorTarget === category) {
      setColorTarget(null);
      return;
    }
    setColorTarget(category);
    setColorDraft(colorFor(category));
    setHexText(colorFor(category));
  };

  const saveColor = () => {
    if (colorTarget !== null) {
      onSetColor(colorTarget, colorDraft);
    }
    setColorTarget(null);
  };

  const commit = async (category: string) => {
    setOpen(false);
    setColorTarget(null);
    const trimmed = category.trim();
    if (trimmed !== "" && trimmed !== value) {
      await onCommit(trimmed);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`Edit category for ${merchant}`}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-blush-100/40 focus:outline-none focus:ring-2 focus:ring-blush-600/40"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: colorFor(value) }}
          />
          {value}
        </span>
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Close category picker"
        className="fixed inset-0 z-10 cursor-default"
        onClick={() => {
          setOpen(false);
          setColorTarget(null);
        }}
      />
      <input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={`category-options-${merchant}`}
        aria-label={`category for ${merchant}`}
        value={draft}
        className="relative z-20 w-full rounded border border-blush-600 bg-white px-1 py-0.5 outline-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit(draft);
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <ul
        id={`category-options-${merchant}`}
        role="listbox"
        aria-label="Categories"
        className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-auto rounded-xl border border-cream-200 bg-white p-1.5 shadow-lg"
      >
        {options.map((category) => (
          <li key={category} className="rounded-lg hover:bg-cream-100">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                aria-label={`Edit color for ${category}`}
                className="h-3 w-3 shrink-0 rounded-full ring-offset-1 hover:ring-2 hover:ring-stone-300"
                style={{ backgroundColor: colorFor(category) }}
                onClick={() => openColorEditor(category)}
              />
              <button
                type="button"
                className="flex-1 text-left text-sm text-stone-700"
                onClick={() => void commit(category)}
              >
                {category}
              </button>
            </div>
            {colorTarget === category && (
              <div className="flex items-center gap-2 px-2 pb-2 pl-7">
                <input
                  type="color"
                  aria-label={`Color value for ${category}`}
                  value={colorDraft}
                  className="h-6 w-8 cursor-pointer rounded border border-cream-200"
                  onChange={(e) => {
                    setColorDraft(e.target.value);
                    setHexText(e.target.value);
                  }}
                />
                <input
                  type="text"
                  aria-label={`Hex color for ${category}`}
                  value={hexText}
                  className="w-20 rounded border border-stone-300 px-1.5 py-0.5 text-xs"
                  onChange={(e) => {
                    setHexText(e.target.value);
                    const match = HEX_RE.exec(e.target.value.trim());
                    if (match) setColorDraft(`#${match[1].toLowerCase()}`);
                  }}
                />
                <button
                  type="button"
                  className="rounded bg-blush-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-blush-800"
                  onClick={saveColor}
                >
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
