"use client";

// Stable, user-editable category colors. Defaults are deterministic (so a
// category keeps its color regardless of spending rank); user overrides
// persist in localStorage — appropriate for a single-user local app.

import { useCallback, useEffect, useState } from "react";

import { CHART_COLORS } from "@/lib/format";
import { CATEGORIES } from "@/lib/openai";

const STORAGE_KEY = "spending-insights.categoryColors";

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function defaultColor(category: string): string {
  const knownIndex = (CATEGORIES as readonly string[]).indexOf(category);
  const index = knownIndex >= 0 ? knownIndex : hashString(category);
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function useCategoryColors() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    // Load after mount so server and client render the same initial markup.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try {
      setOverrides(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"));
    } catch {
      // corrupted storage — fall back to defaults
    }
  }, []);

  const colorFor = useCallback(
    (category: string) => overrides[category] ?? defaultColor(category),
    [overrides]
  );

  const setColor = useCallback((category: string, color: string) => {
    setOverrides((previous) => {
      const next = { ...previous, [category]: color };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { colorFor, setColor };
}
