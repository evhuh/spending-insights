// HTTP client for the Python extractor service (the only thing that parses PDFs).
// PDF bytes are streamed straight through — never written to disk.

export interface StatementPeriod {
  year: number;
  closingDate: string | null;
  yearResolved: boolean;
}

export interface ExtractedTransaction {
  date: string; // ISO date
  merchant: string; // standardized name
  rawDescription: string; // for trust/debugging only — never stored
  amount: number; // positive
}

export interface ExtractValidation {
  extractedPurchaseTotal: number;
  statementPurchaseTotal: number | null;
  match: boolean;
}

export interface ExtractResult {
  statementPeriod: StatementPeriod;
  transactions: ExtractedTransaction[];
  validation: ExtractValidation;
}

export async function extractStatement(
  pdfBytes: ArrayBuffer,
  fileName: string,
  statementYear?: number
): Promise<ExtractResult> {
  const baseUrl = process.env.EXTRACTOR_URL ?? "http://localhost:8000";
  const form = new FormData();
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);
  if (statementYear !== undefined) {
    form.append("statementYear", String(statementYear));
  }

  const response = await fetch(`${baseUrl}/extract`, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`extractor responded ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as ExtractResult;
}
