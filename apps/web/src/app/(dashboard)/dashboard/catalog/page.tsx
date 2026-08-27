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
  discountPriceKobo: string | null;
  categoryId: string;
  brandId: string;
  status: string;
  stockQuantity: number;
  isPopular: boolean;
  tags: string[];
  unit: string;
}
interface Banner {
  id: string;
  brand: string;
  imagePath: string;
  tagline: string | null;
  categoryId: string | null;
  color: string | null;
}

const STATUS_TONE = { draft: "neutral", published: "success", archived: "error" } as const;
const EMPTY_PRODUCT = {
  name: "",
  imageUrl: "",
  priceNaira: "",
  discountNaira: "",
  categoryId: "",
  brandId: "",
  unit: "",
  stockQuantity: "0",
  tags: "",
  isPopular: false,
  status: "draft",
};

// Hoisted to module scope so React keeps the same element identity across
// renders — a component defined inside CatalogPage would remount every
// keystroke and the focused input would lose focus.
function ProductFields({
  form,
  set,
  categories,
  brands,
}: {
  form: typeof EMPTY_PRODUCT;
  set: (updater: (f: typeof EMPTY_PRODUCT) => typeof EMPTY_PRODUCT) => void;
  categories: Category[];
  brands: Brand[];
}) {
  return (
    <>
      <Input label="Product name" value={form.name} onChange={(e) => set((f) => ({ ...f, name: e.target.value }))} required />
      <Input label="Image URL" placeholder="https://res.cloudinary.com/..." value={form.imageUrl} onChange={(e) => set((f) => ({ ...f, imageUrl: e.target.value }))} required />
      <Input type="number" label="Price, ₦" value={form.priceNaira} onChange={(e) => set((f) => ({ ...f, priceNaira: e.target.value }))} min={1} required />
      <Input type="number" label="Discount price, ₦ (optional)" value={form.discountNaira} onChange={(e) => set((f) => ({ ...f, discountNaira: e.target.value }))} min={0} />
      <Select label="Category" value={form.categoryId} onChange={(e) => set((f) => ({ ...f, categoryId: e.target.value }))} required>
        <option value="">Select…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </Select>
      <Select label="Brand" value={form.brandId} onChange={(e) => set((f) => ({ ...f, brandId: e.target.value }))} required>
        <option value="">Select…</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </Select>
      <Input label="Unit" placeholder="e.g. 50kg bag" value={form.unit} onChange={(e) => set((f) => ({ ...f, unit: e.target.value }))} required />
      <Input type="number" label="Stock" value={form.stockQuantity} onChange={(e) => set((f) => ({ ...f, stockQuantity: e.target.value }))} min={0} />
      <Input label="Tags (comma-separated)" placeholder="rice, big bull, 50kg" value={form.tags} onChange={(e) => set((f) => ({ ...f, tags: e.target.value }))} />
      <Select label="Status" value={form.status} onChange={(e) => set((f) => ({ ...f, status: e.target.value }))}>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="archived">Archived</option>
      </Select>
      <label className="flex items-center gap-2 self-end text-sm text-text-dark">
        <input type="checkbox" checked={form.isPopular} onChange={(e) => set((f) => ({ ...f, isPopular: e.target.checked }))} />
        Popular
      </label>
    </>
  );
}

// A quick, unlabeled create row — a category is a single word, so a full
// form with its own submit button reads heavier than the data it captures.
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

// The grid half of the real merchandising UI (§10, §11.4). An admin can add,
// edit, and publish a product — plus manage brands and the promo carousel —
// and it shows up on the public /marketplace page and in the phone app.
export default function CatalogPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [brandForm, setBrandForm] = useState({ name: "", tagline: "", imagePath: "", color: "" });
  const [productForm, setProductForm] = useState({ ...EMPTY_PRODUCT });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ ...EMPTY_PRODUCT });
  const [bannerForm, setBannerForm] = useState({ brand: "", imageUrl: "", tagline: "", categoryId: "", color: "" });
  const [busy, setBusy] = useState(false);

  // Each response is checked before being trusted as the array it's supposed
  // to be — an error body (e.g. a 403 from a non-admin role) is an object,
  // and calling .map() on it crashed the whole page instead of showing a message.
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
      loadOne<Banner[]>("/v1/admin/catalog/banners", () => router.push("/login")),
    ])
      .then(([c, b, p, bn]) => {
        setCategories(c);
        setBrands(b);
        setProducts(p);
        setBanners(bn);
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

  async function post(path: string, body: unknown) {
    const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
    return data;
  }

  function productPayload(form: typeof EMPTY_PRODUCT) {
    return {
      name: form.name,
      imageUrl: form.imageUrl,
      priceNaira: Number(form.priceNaira),
      discountPriceNaira: form.discountNaira ? Number(form.discountNaira) : undefined,
      categoryId: form.categoryId,
      brandId: form.brandId,
      unit: form.unit,
      stockQuantity: Number(form.stockQuantity),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      isPopular: form.isPopular,
      status: form.status,
    };
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/v1/admin/catalog/categories", { name: categoryName });
      setCategoryName("");
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/v1/admin/catalog/brands", {
        name: brandForm.name,
        tagline: brandForm.tagline || undefined,
        imagePath: brandForm.imagePath || undefined,
        color: brandForm.color || undefined,
      });
      setBrandForm({ name: "", tagline: "", imagePath: "", color: "" });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/v1/admin/catalog/products", productPayload(productForm));
      setProductForm({ ...EMPTY_PRODUCT });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create product");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      imageUrl: p.imageUrl,
      priceNaira: String(Number(p.priceKobo) / 100),
      discountNaira: p.discountPriceKobo ? String(Number(p.discountPriceKobo) / 100) : "",
      categoryId: p.categoryId,
      brandId: p.brandId,
      unit: p.unit,
      stockQuantity: String(p.stockQuantity),
      tags: (p.tags ?? []).join(", "),
      isPopular: p.isPopular,
      status: p.status,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/admin/catalog/products/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(productPayload(editForm)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to update product");
      setEditingId(null);
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update product");
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

  async function createBanner(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/v1/admin/catalog/banners", {
        brand: bannerForm.brand,
        imageUrl: bannerForm.imageUrl,
        tagline: bannerForm.tagline || undefined,
        categoryId: bannerForm.categoryId || undefined,
        color: bannerForm.color || undefined,
      });
      setBannerForm({ brand: "", imageUrl: "", tagline: "", categoryId: "", color: "" });
      loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBanner(id: string) {
    await apiFetch(`/v1/admin/catalog/banners/${id}`, { method: "DELETE" });
    loadAll();
  }

  const categoryName_ = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";
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
                <Badge key={c.id} tone="neutral">{c.name}</Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-text-dark">Brands</h2>
          <form onSubmit={createBrand} className="mt-3 flex flex-col gap-2">
            <Input placeholder="Name — e.g. Big Bull" value={brandForm.name} onChange={(e) => setBrandForm((f) => ({ ...f, name: e.target.value }))} required />
            <Input placeholder="Tagline (optional)" value={brandForm.tagline} onChange={(e) => setBrandForm((f) => ({ ...f, tagline: e.target.value }))} />
            <Input placeholder="Image URL (optional)" value={brandForm.imagePath} onChange={(e) => setBrandForm((f) => ({ ...f, imagePath: e.target.value }))} />
            <div className="flex gap-2">
              <Input placeholder="#1A7A4C" value={brandForm.color} onChange={(e) => setBrandForm((f) => ({ ...f, color: e.target.value }))} />
              <Button type="submit" disabled={busy} variant="secondary" className="px-3">
                <PlusIcon className="h-4 w-4" />
              </Button>
            </div>
          </form>
          {brands.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {brands.map((b) => (
                <Badge key={b.id} tone="neutral">{b.name}</Badge>
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
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Promo banners</span>
              <span className="font-semibold tabular-nums text-text-dark">{banners.length}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">Add a product</h2>
        <form onSubmit={createProduct} className="mt-4 grid grid-cols-3 gap-4">
          <ProductFields form={productForm} set={setProductForm} categories={categories} brands={brands} />
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
                <div className="absolute right-2 top-2 flex gap-1">
                  {p.isPopular && <Badge tone="success">Popular</Badge>}
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
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => (editingId === p.id ? setEditingId(null) : startEdit(p))}
                    className="flex-1 rounded-[var(--radius-sm)] border border-dark-border/60 py-1.5 text-xs font-semibold text-text-medium transition-colors hover:bg-surface"
                  >
                    {editingId === p.id ? "Close" : "Edit"}
                  </button>
                  <button
                    onClick={() => togglePublish(p)}
                    className="flex-1 rounded-[var(--radius-sm)] border border-dark-border/60 py-1.5 text-xs font-semibold text-text-medium transition-colors hover:bg-surface"
                  >
                    {p.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                </div>
                {editingId === p.id && (
                  <form onSubmit={saveEdit} className="mt-3 grid grid-cols-1 gap-3 border-t border-dark-border/60 pt-3">
                    <ProductFields form={editForm} set={setEditForm} categories={categories} brands={brands} />
                    <Button type="submit" disabled={busy} className="w-full">Save changes</Button>
                  </form>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-text-dark">Promo banners</h2>
        <p className="mt-1 text-xs text-text-muted">The carousel on the app home screen and marketplace.</p>
        <form onSubmit={createBanner} className="mt-4 grid grid-cols-3 gap-4">
          <Input label="Brand" value={bannerForm.brand} onChange={(e) => setBannerForm((f) => ({ ...f, brand: e.target.value }))} required />
          <Input label="Image URL" placeholder="https://res.cloudinary.com/..." value={bannerForm.imageUrl} onChange={(e) => setBannerForm((f) => ({ ...f, imageUrl: e.target.value }))} required />
          <Input label="Tagline" value={bannerForm.tagline} onChange={(e) => setBannerForm((f) => ({ ...f, tagline: e.target.value }))} />
          <Select label="Category" value={bannerForm.categoryId} onChange={(e) => setBannerForm((f) => ({ ...f, categoryId: e.target.value }))}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Input label="Colour" placeholder="#1A7A4C" value={bannerForm.color} onChange={(e) => setBannerForm((f) => ({ ...f, color: e.target.value }))} />
          <div className="col-span-3 flex justify-end border-t border-dark-border/60 pt-4">
            <Button type="submit" disabled={busy}>
              <PlusIcon className="h-4 w-4" />
              Add banner
            </Button>
          </div>
        </form>
        {banners.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            {banners.map((b) => (
              <Card key={b.id} className="flex flex-col overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.imagePath} alt="" className="h-24 w-full object-cover" />
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="text-sm font-semibold text-text-dark">{b.brand}</p>
                  <p className="truncate text-xs text-text-muted">{b.tagline ?? "—"}</p>
                  <p className="text-xs text-text-muted">{categoryName_(b.categoryId)}</p>
                  <button
                    onClick={() => deleteBanner(b.id)}
                    className="mt-2 rounded-[var(--radius-sm)] border border-dark-border/60 py-1.5 text-xs font-semibold text-error transition-colors hover:bg-surface"
                  >
                    Remove
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
