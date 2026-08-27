"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";
import { formatNaira } from "../../../../lib/format";
import { PageHeader, Card, EmptyState } from "../../../../components/ui/Card";
import { Badge } from "../../../../components/ui/Badge";
import { Button } from "../../../../components/ui/Button";
import { Input, Select } from "../../../../components/ui/Field";
import { PlusIcon, BoxIcon } from "../../../../components/ui/icons";

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

// A quick, unlabeled create row — a category or brand is a single word,
// so a full form with its own submit button reads heavier than the data
// it captures. The icon button is deliberately small; this is a utility
// action, not the page's primary one.
function QuickAddRow({
  placeholder,
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="mt-3 flex gap-2">
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} required />
      <Button type="submit" disabled={disabled} variant="secondary" className="px-3">
        <PlusIcon className="h-4 w-4" />
      </Button>
    </form>
  );
}

// Stand-in for the real merchandising UI (§10, §11.4) — drag-reorder,
// phone-frame preview, bulk publish, grid/table toggle. This is the grid
// half of that (closer to how the storefront actually reads than a plain
// table was) plus the minimum that closes the loop: an admin can add a
// product and publish it, and it shows up on the public /marketplace page.
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

  // Each response is checked before being trusted as the array it's
  // supposed to be — an error body (e.g. a 403 from a non-admin role, which
  // is a real, intended outcome, not a bug) is an object, and calling
  // .map() on it crashed the whole page instead of showing a message.
  async function loadOne<T>(path: string, onUnauthorized: () => void): Promise<T> {
    const res = await apiFetch(path);
    if (res.status === 401) {
      onUnauthorized();
      throw new Error("Session expired");
    }
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.message ?? `Request to ${path} failed (${res.status})`);
    }
    return body as T;
  }

  function loadAll() {
    Promise.all([
      loadOne<Category[]>("/v1/admin/catalog/categories", () => router.push("/login")),
      loadOne<Brand[]>("/v1/admin/catalog/brands", () => router.push("/login")),
      loadOne<Product[]>("/v1/admin/catalog/products", () => router.push("/login")),
    ])
      .then(([c, b, p]) => {
        setCategories(c);
        setBrands(b);
        setProducts(p);
        setError(null);
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

  const categoryName_ = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";
  const brandName_ = (id: string) => brands.find((b) => b.id === id)?.name ?? "—";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title="Catalog" description="What's for sale, and what's actually live on the storefront." />
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Categories</h2>
          <QuickAddRow placeholder="e.g. Rice" value={categoryName} onChange={setCategoryName} onSubmit={createCategory} disabled={busy} />
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
          <QuickAddRow placeholder="e.g. Big Bull" value={brandName} onChange={setBrandName} onSubmit={createBrand} disabled={busy} />
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

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">At a glance</h2>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Products</span>
              <span className="font-semibold tabular-nums text-text-dark">{products.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Published</span>
              <span className="font-semibold tabular-nums text-success">
                {products.filter((p) => p.status === "published").length}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Draft</span>
              <span className="font-semibold tabular-nums text-text-medium">
                {products.filter((p) => p.status === "draft").length}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">Add a product</h2>
        <form onSubmit={createProduct} className="mt-4 grid grid-cols-3 gap-4">
          <Input
            label="Product name"
            value={productForm.name}
            onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <Input
            label="Image URL"
            placeholder="/products/... or https://..."
            value={productForm.imageUrl}
            onChange={(e) => setProductForm((f) => ({ ...f, imageUrl: e.target.value }))}
            required
          />
          <Input
            type="number"
            label="Price, ₦"
            value={productForm.priceNaira}
            onChange={(e) => setProductForm((f) => ({ ...f, priceNaira: e.target.value }))}
            min={1}
            required
          />
          <Select
            label="Category"
            value={productForm.categoryId}
            onChange={(e) => setProductForm((f) => ({ ...f, categoryId: e.target.value }))}
            required
          >
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Brand"
            value={productForm.brandId}
            onChange={(e) => setProductForm((f) => ({ ...f, brandId: e.target.value }))}
            required
          >
            <option value="">Select…</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Input
            label="Unit"
            placeholder="e.g. 50kg bag"
            value={productForm.unit}
            onChange={(e) => setProductForm((f) => ({ ...f, unit: e.target.value }))}
            required
          />
          <Input
            type="number"
            label="Stock"
            value={productForm.stockQuantity}
            onChange={(e) => setProductForm((f) => ({ ...f, stockQuantity: e.target.value }))}
            min={0}
          />
          <div className="col-span-3 flex justify-end border-t border-dark-border/60 pt-4">
            <Button type="submit" disabled={busy}>
              <PlusIcon className="h-4 w-4" />
              Add product
            </Button>
          </div>
        </form>
      </Card>

      {products.length === 0 ? (
        <EmptyState label="No products yet." />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col overflow-hidden">
              <div className="relative h-32 w-full bg-surface">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <BoxIcon className="h-8 w-8 text-text-muted" />
                  </div>
                )}
                <div className="absolute right-2 top-2">
                  <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}>{p.status}</Badge>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="truncate text-sm font-semibold text-text-dark">{p.name}</p>
                <p className="truncate text-xs text-text-muted">
                  {brandName_(p.brandId)} · {categoryName_(p.categoryId)}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm font-bold tabular-nums text-primary">{formatNaira(p.priceKobo)}</span>
                  <span className="text-xs tabular-nums text-text-muted">{p.stockQuantity} in stock</span>
                </div>
                <button
                  onClick={() => togglePublish(p)}
                  className="mt-3 rounded-[var(--radius-sm)] border border-dark-border/60 py-1.5 text-xs font-semibold text-text-medium transition-colors hover:bg-surface"
                >
                  {p.status === "published" ? "Unpublish" : "Publish"}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
