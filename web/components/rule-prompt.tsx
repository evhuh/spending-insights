"use client";

export function RulePrompt({
  merchant,
  category,
  onAccept,
  onDecline,
}: {
  merchant: string;
  category: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Apply category to future transactions"
        className="w-full max-w-md rounded-2xl border border-cream-200 bg-white p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold text-stone-900">Remember this category?</h2>
        <p className="mt-2 text-sm text-stone-600">
          Apply <span className="font-medium text-stone-900">{category}</span> to future
          transactions from{" "}
          <span className="font-medium text-stone-900">{merchant}</span>?
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 hover:bg-cream-100"
            onClick={onDecline}
          >
            Just this once
          </button>
          <button
            type="button"
            className="rounded-lg bg-blush-700 px-4 py-2 text-sm font-medium text-white hover:bg-blush-800"
            onClick={onAccept}
          >
            Apply to future
          </button>
        </div>
      </div>
    </div>
  );
}
