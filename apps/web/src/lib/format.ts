export function formatNaira(kobo: string | number | null | undefined): string {
  if (kobo === null || kobo === undefined) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(kobo) / 100,
  );
}

// The order/wallet/credit endpoints convert kobo → naira server-side before
// the JSON ever leaves (`OrdersService.toResponse`'s `koboToNaira` calls,
// `WalletService.getCreditProfile`) — this formats those already-naira
// numbers, so callers never divide by 100 twice.
export function formatNairaAmount(naira: number | string | null | undefined): string {
  if (naira === null || naira === undefined) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(naira),
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
