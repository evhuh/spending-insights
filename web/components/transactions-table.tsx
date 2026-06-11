"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";

import { CategoryPicker } from "@/components/category-picker";
import { EditableCell } from "@/components/editable-cell";
import { formatDate, formatUsd } from "@/lib/format";
import type { TransactionJson } from "@/lib/transactions";

const columnHelper = createColumnHelper<TransactionJson>();

export function TransactionsTable({
  transactions,
  colorFor,
  onSetColor,
  onEdit,
}: {
  transactions: TransactionJson[];
  colorFor: (category: string) => string;
  onSetColor: (category: string, color: string) => void;
  onEdit: (id: string, field: string, value: unknown) => Promise<boolean>;
}) {
  const columns = useMemo(
    () =>
      [
        columnHelper.accessor("date", {
          header: "Date",
          cell: ({ row }) => (
            <EditableCell
              type="date"
              value={row.original.date}
              display={formatDate(row.original.date)}
              label={`date for ${row.original.merchant}`}
              onCommit={(v) => onEdit(row.original.id, "date", v)}
            />
          ),
        }),
        columnHelper.accessor("merchant", {
          header: "Merchant",
          cell: ({ row }) => (
            <EditableCell
              value={row.original.merchant}
              label={`merchant for ${row.original.merchant}`}
              onCommit={(v) => onEdit(row.original.id, "merchant", v)}
            />
          ),
        }),
        columnHelper.accessor("category", {
          header: "Category",
          cell: ({ row }) => (
            <CategoryPicker
              value={row.original.category}
              merchant={row.original.merchant}
              colorFor={colorFor}
              onSetColor={onSetColor}
              onCommit={(v) => onEdit(row.original.id, "category", v)}
            />
          ),
        }),
        columnHelper.accessor("amount", {
          header: () => <span className="block text-right">Amount</span>,
          cell: ({ row }) => (
            <EditableCell
              type="number"
              align="right"
              value={String(row.original.amount)}
              display={
                <span className="tabular-nums">{formatUsd(row.original.amount)}</span>
              }
              label={`amount for ${row.original.merchant}`}
              onCommit={(v) => onEdit(row.original.id, "amount", Number(v))}
            />
          ),
        }),
        columnHelper.accessor("notes", {
          header: "Notes",
          cell: ({ row }) => (
            <EditableCell
              value={row.original.notes ?? ""}
              label={`notes for ${row.original.merchant}`}
              onCommit={(v) => onEdit(row.original.id, "notes", v === "" ? null : v)}
            />
          ),
        }),
      ] as ColumnDef<TransactionJson>[],
    [onEdit, colorFor, onSetColor]
  );

  const table = useReactTable({
    data: transactions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <section
      aria-label="Transactions"
      className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-sm"
    >
      <div className="max-h-[calc(100dvh-23rem)] min-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-cream-100 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-stone-100">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-cream-100/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-stone-400">
                  No transactions — upload a statement to get started.
                </td>
              </tr>
          )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
