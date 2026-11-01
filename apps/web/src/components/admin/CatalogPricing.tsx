"use client";

import { useEffect, useState } from "react";
import { calculateCatalogPrice, nairaToKobo, type CatalogPricingRates } from "@farmermarket/core";
import { apiFetch } from "../../lib/auth";
import { formatNairaAmount } from "../../lib/format";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";

interface PriceListItem {
  sourceRow: number; sku: string; name: string; sourceSize: string; unit: string;
  costPriceNaira: number; imageFile: string | null; reviewNote: string | null;
}

export function CatalogPricing({ rates, managedCount, onSaved }: {
  rates: CatalogPricingRates; managedCount: number; onSaved: () => void;
}) {
  const [markup, setMarkup] = useState(String(rates.markupPercent));
  const [insurance, setInsurance] = useState(String(rates.insurancePercent));
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setMarkup(String(rates.markupPercent)); setInsurance(String(rates.insurancePercent)); }, [rates]);
  useEffect(() => {
    apiFetch("/v1/admin/catalog/price-list").then(async res => {
      if (!res.ok) throw new Error("Could not load the price list");
      setItems(await res.json());
    }).catch(err => setError(err.message));
  }, []);

  const draftRates = { markupPercent: Number(markup), insurancePercent: Number(insurance) };
  let valid = markup !== "" && insurance !== "";
  try { calculateCatalogPrice(100n, draftRates); } catch { valid = false; }
  const changed = Number(markup) !== rates.markupPercent || Number(insurance) !== rates.insurancePercent;

  async function saveRates(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const res = await apiFetch("/v1/admin/catalog/pricing", { method: "PATCH", body: JSON.stringify(draftRates) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Could not save percentages");
      setMessage(`Percentages saved. ${body.updatedProducts} product prices updated.`);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save percentages"); }
    finally { setBusy(false); }
  }

  async function importProducts() {
    if (busy || changed) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const res = await apiFetch("/v1/admin/catalog/price-list/import", { method: "POST", body: JSON.stringify({ imageBaseUrl: window.location.origin }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Could not import products");
      setMessage(`${body.added} draft products added. ${body.skipped} previously imported products kept. Review sizes and images, then receive stock in Inventory before publishing.`);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not import products"); }
    finally { setBusy(false); }
  }

  return <Card className="p-5">
    <h2 className="text-base font-semibold text-text-dark">Cost, markup & insurance</h2>
    <p className="mt-1 text-sm text-text-muted">Selling price = cost × (1 + markup). Insurance is calculated on that selling price and included in the product total.</p>
    <form onSubmit={saveRates} className="mt-4 grid gap-4 sm:grid-cols-3">
      <Input type="number" step="0.01" min="0" max="1000" required label="Markup (%)" value={markup} onChange={e => setMarkup(e.target.value)} />
      <Input type="number" step="0.01" min="0" max="1000" required label="Insurance (% of selling price)" value={insurance} onChange={e => setInsurance(e.target.value)} />
      <Button type="submit" className="self-end" disabled={busy || !valid || !changed}>Save percentages & update {managedCount} prices</Button>
    </form>
    <p className="mt-3 text-xs text-text-muted">Applies to products using percentage pricing. Manual prices and existing orders keep their prices. Delivery, service and repayment-plan charges remain separate.</p>
    {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
    <details className="mt-5 border-t border-dark-border/60 pt-4">
      <summary className="cursor-pointer text-sm font-semibold text-primary">November price list — preview & import 21 products</summary>
      <p className="my-3 text-sm text-text-muted">Costs come from the supplied price list. Import creates drafts with zero stock. Six photos match the listed products; other rows need an image or size review. Re-importing keeps existing edits.</p>
      {changed && <p className="mb-3 text-sm text-text-medium">Preview uses your unsaved percentages. Save them before importing.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-dark-border/60"><th className="p-2">Product / sale unit</th><th className="p-2 text-right">Cost</th><th className="p-2 text-right">Selling</th><th className="p-2 text-right">Insurance</th><th className="p-2 text-right">Total</th><th className="p-2">Review</th></tr></thead>
          <tbody>{items.map(item => {
            const price = valid ? calculateCatalogPrice(nairaToKobo(item.costPriceNaira), draftRates) : null;
            return <tr key={item.sku} className="border-b border-dark-border/40 align-top">
              <td className="p-2 font-medium">{item.name}<span className="block text-xs font-normal text-text-muted">{item.unit}</span></td>
              <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatNairaAmount(item.costPriceNaira)}</td>
              <td className="whitespace-nowrap p-2 text-right tabular-nums">{price ? formatNairaAmount(Number(price.sellingKobo) / 100) : "—"}</td>
              <td className="whitespace-nowrap p-2 text-right tabular-nums">{price ? formatNairaAmount(Number(price.insuranceKobo) / 100) : "—"}</td>
              <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">{price ? formatNairaAmount(Number(price.priceKobo) / 100) : "—"}</td>
              <td className="min-w-48 p-2 text-xs text-text-muted">{item.reviewNote ?? "Matching studio photo available"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <Button type="button" onClick={importProducts} disabled={busy || changed || !items.length} className="mt-4">Add price-list products as drafts</Button>
    </details>
  </Card>;
}
