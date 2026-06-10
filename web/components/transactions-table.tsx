"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";

import { EditableCell } from "@/components/editable-cell";
import { CATEGORIES } from "@/lib/openai";
import { formatDate, formatUsd } from "@/lib/format";
import type { TransactionJson } from "@/lib/transactions";

const columnHelper = createColumnHelper<TransactionJson>();

export function TransactionsTable({
  transactions,
  categoryColors,
  onEdit,
}: {
  transactions: TransactionJson[];
  categoryColors: Map<string, string>;
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
            <EditableCell
              value={row.original.category}
              listId="category-options"
              label={`category for ${row.original.merchant}`}
              display={
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: categoryColors.get(row.original.category) ?? "#d6d3d1",
                    }}
                  />
                  {row.original.category}
                </span>
              }
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
    [onEdit, categoryColors]
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
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"
    >
      <datalist id="category-options">
        {CATEGORIES.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs font-semibold uppercase tracking-wider text-stone-500">
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
            <tr key={row.id} className="hover:bg-stone-50/60">
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
    </section>
  );
}
