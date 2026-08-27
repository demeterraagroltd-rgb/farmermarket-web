"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatNaira } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Input, Select } from "../../../../components/ui/Field";

interface Category {
  id: string;
  name: string;
}
interface Brand {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  imageUrl: string;
  priceKobo: string;
  categoryId: string;
  brandId: string;
  status: string;
  stockQuantity: number;
}

const STATUS_TONE = { draft: "neutral", published: "success", archived: "error" } as const;

// Stand-in for the real merchandising UI (§10, §11.4) — drag-reorder,
// phone-frame preview, bulk publish. This is the minimum that closes the
// loop: an admin can add a product and publish it, and it shows up on
// the public /marketplace page.
export default function CatalogPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [productForm, setProductForm] = useState({
    name: "",
    imageUrl: "",
    priceNaira: "",
    categoryId: "",
    brandId: "",
    unit: "",
    stockQuantity: "0",
  });
  const [busy, setBusy] = useState(false);

  function loadAll() {
    Promise.all([
      apiFetch("/v1/admin/catalog/categories").then((r) => r.json()),
      apiFetch("/v1/admin/catalog/brands").then((r) => r.json()),
      apiFetch("/v1/admin/catalog/products").then((r) => r.json()),
    ])
      .then(([c, b, p]) => {
        setCategories(c);
        setBrands(b);
        setProducts(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load catalog"));
  }

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/v1/admin/catalog/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryName }),
      });
      setCategoryName("");
      loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/v1/admin/catalog/brands", {
        method: "POST",
        body: JSON.stringify({ name: brandName }),
      });
      setBrandName("");
      loadAll();
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/v1/admin/catalog/products", {
        method: "POST",
        body: JSON.stringify({
          ...productForm,
          priceNaira: Number(productForm.priceNaira),
          stockQuantity: Number(productForm.stockQuantity),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Failed to create product");
      setProductForm({ name: "", imageUrl: "", priceNaira: "", categoryId: "", brandId: "", unit: "", stockQuantity: "0" });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(product: Product) {
    const nextStatus = product.status === "published" ? "draft" : "published";
    await apiFetch(`/v1/admin/catalog/products/${product.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    });
    loadAll();
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title="Catalog" description="What's for sale, and what's actually live on the storefront." />
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Categories</h2>
          <form onSubmit={createCategory} className="mt-3 flex gap-2">
            <Input
              placeholder="e.g. Rice"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
          {categories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <Badge key={c.id} tone="neutral">
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Brands</h2>
          <form onSubmit={createBrand} className="mt-3 flex gap-2">
            <Input
              placeholder="e.g. Big Bull"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
          {brands.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brands.map((b) => (
                <Badge key={b.id} tone="neutral">
                  {b.name}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">Add a product</h2>
        <form onSubmit={createProduct} className="mt-3 grid grid-cols-3 gap-3">
          <Input
            placeholder="Product name"
            value={productForm.name}
            onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <Input
            placeholder="Image URL (or /products/... )"
            value={productForm.imageUrl}
            onChange={(e) => setProductForm((f) => ({ ...f, imageUrl: e.target.value }))}
            required
          />
          <Input
            type="number"
            placeholder="Price, ₦"
            value={productForm.priceNaira}
            onChange={(e) => setProductForm((f) => ({ ...f, priceNaira: e.target.value }))}
            min={1}
            required
          />
          <Select
            value={productForm.categoryId}
            onChange={(e) => setProductForm((f) => ({ ...f, categoryId: e.target.value }))}
            required
          >
            <option value="">Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={productForm.brandId}
            onChange={(e) => setProductForm((f) => ({ ...f, brandId: e.target.value }))}
            required
          >
            <option value="">Brand</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Input
            placeholder="Unit (e.g. 50kg bag)"
            value={productForm.unit}
            onChange={(e) => setProductForm((f) => ({ ...f, unit: e.target.value }))}
            required
          />
          <Input
            type="number"
            placeholder="Stock"
            value={productForm.stockQuantity}
            onChange={(e) => setProductForm((f) => ({ ...f, stockQuantity: e.target.value }))}
            min={0}
          />
          <Button type="submit" disabled={busy} className="col-span-3 self-start">
            Add product (draft)
          </Button>
        </form>
      </Card>

      {products.length === 0 ? (
        <EmptyState label="No products yet." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-dark-border/60 text-xs font-semibold uppercase tracking-wide text-text-muted">
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Price</th>
                <th className="px-5 py-3">Stock</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-dark-border/40 last:border-0">
                  <td className="flex items-center gap-3 px-5 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="h-10 w-10 rounded-[var(--radius-sm)] object-cover"
                    />
                    <span className="font-medium text-text-dark">{p.name}</span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-text-dark">{formatNaira(p.priceKobo)}</td>
                  <td className="px-5 py-3 tabular-nums text-text-medium">{p.stockQuantity}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}>
                      {p.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => togglePublish(p)} className="text-sm font-medium text-primary hover:underline">
                      {p.status === "published" ? "Unpublish" : "Publish"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
