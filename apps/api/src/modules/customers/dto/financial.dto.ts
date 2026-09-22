import { z } from "zod";

// Query-string filters for a customer's stored bank transactions. Everything is
// optional and validated here so the service can trust its inputs: a bad date
// is a 400 with the field named, not an Invalid Date reaching Postgres.

const isoDate = z
  .string()
  .trim()
  .refine((s) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s) && !Number.isNaN(Date.parse(s)), "Date must look like 2026-09-30.");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : undefined));

const naira = z.coerce.number().finite().min(0).max(100_000_000_000);

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
/** The export is capped: a year of one busy account, not an unbounded table dump. */
export const EXPORT_ROW_LIMIT = 20_000;

const filterShape = {
  accountId: z.string().uuid().optional(),
  type: z.enum(["credit", "debit"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minNaira: naira.optional(),
  maxNaira: naira.optional(),
  channel: optionalText(60),
  q: optionalText(120),
};

// A date-only `to` means "through the end of that day", not its first instant —
// otherwise "to 30 Sept" would silently drop everything that happened on the 30th.
const orderedRange = (v: { from?: string; to?: string; minNaira?: number; maxNaira?: number }, ctx: z.RefinementCtx) => {
  if (v.from && v.to && Date.parse(v.from) > Date.parse(v.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "The end date is before the start date." });
  }
  if (v.minNaira !== undefined && v.maxNaira !== undefined && v.minNaira > v.maxNaira) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxNaira"], message: "The maximum amount is below the minimum." });
  }
};

export const transactionFilterSchema = z.object(filterShape).superRefine(orderedRange);
export type TransactionFilterInput = z.infer<typeof transactionFilterSchema>;

export const transactionListSchema = z
  .object({
    ...filterShape,
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sort: z.enum(["newest", "oldest", "largest", "smallest"]).default("newest"),
  })
  .superRefine(orderedRange);
export type TransactionListInput = z.infer<typeof transactionListSchema>;

export const statementQuerySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .superRefine(orderedRange);
export type StatementQueryInput = z.infer<typeof statementQuerySchema>;

export const incomeSourcesQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  months: z.coerce.number().int().min(1).max(24).default(6),
});
export type IncomeSourcesQueryInput = z.infer<typeof incomeSourcesQuerySchema>;

export const rawListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type RawListQueryInput = z.infer<typeof rawListQuerySchema>;
