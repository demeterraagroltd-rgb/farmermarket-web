"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/auth";
import { formatNairaAmount } from "../../lib/format";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface MarketProduct {
  sku: string; name: string; unit: string; retailPriceNaira: number | null;
  sourceName: string; sourceUrl: string; checkedAt: string; note: string; imageFile: string;
}

export function MarketPriceProducts({ onSaved }: { onSaved: () => void }) {
  const [items, setItems] = useState<MarketProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    apiFetch("/v1/admin/catalog/market-prices").then(async res => {
      if (!res.ok) throw new Error("Could not load online price references");
      setItems(await res.json());
    }).catch(err => setError(err.message));
  }, []);

  async function importProducts() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await apiFetch("/v1/admin/catalog/market-prices/import", { method: "POST", body: JSON.stringify({ imageBaseUrl: window.location.origin }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Could not add online-priced products");
      setMessage(`${body.added} draft products added; ${body.skipped} existing products kept. ${body.pending} product still needs a verified price.`);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add products"); }
    finally { setBusy(false); }
  }

  return <Card className="p-5">
    <details>
      <summary className="cursor-pointer text-sm font-semibold text-primary">Additional studio products — online selling prices</summary>
      <p className="my-3 text-sm text-text-muted">Retailer listings checked 1 November 2026. These are editable manual selling prices. To use percentage pricing later, enter your supplier cost and select Cost + markup + insurance.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(item => <div key={item.sku} className="rounded-lg border border-dark-border/60 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/catalog/studio/${item.imageFile}`} alt={item.name} className="h-28 w-full bg-white object-contain" loading="lazy" />
          <p className="mt-2 text-sm font-semibold">{item.name}</p>
          <p className="text-xs text-text-muted">{item.unit}</p>
          <p className="mt-1 text-sm font-semibold text-primary">{item.retailPriceNaira === null ? "Price not verified" : formatNairaAmount(item.retailPriceNaira)}</p>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-primary underline">{item.sourceName}</a>
          <p className="mt-2 text-xs text-text-muted">{item.note}</p>
        </div>)}
      </div>
      <Button type="button" onClick={importProducts} disabled={busy || !items.length} className="mt-4">Add 4 online-priced products as drafts</Button>
      {message && <p role="status" className="mt-3 text-sm text-success">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-error">{error}</p>}
    </details>
  </Card>;
}
