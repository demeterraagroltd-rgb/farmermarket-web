"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "../../../../lib/auth";

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
  priceKobo: string;
  categoryId: string;
  brandId: string;
  status: string;
  stockQuantity: number;
}

function formatNaira(kobo: string): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(kobo) / 100,
  );
}

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
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-bold text-text-dark">Catalog</h1>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4">
        <form onSubmit={createCategory} className="flex gap-2 rounded-lg border border-dark-border p-4">
          <input
            placeholder="New category"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            className="flex-1 rounded-md border border-dark-border px-3 py-2"
            required
          />
          <button disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">
            Add
          </button>
        </form>
        <form onSubmit={createBrand} className="flex gap-2 rounded-lg border border-dark-border p-4">
          <input
            placeholder="New brand"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            className="flex-1 rounded-md border border-dark-border px-3 py-2"
            required
          />
          <button disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white">
            Add
          </button>
        </form>
      </div>

      <form onSubmit={createProduct} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dark-border p-4">
        <input
          placeholder="Product name"
          value={productForm.name}
          onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
        <input
          placeholder="Image URL"
          value={productForm.imageUrl}
          onChange={(e) => setProductForm((f) => ({ ...f, imageUrl: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
        <input
          type="number"
          placeholder="Price, ₦"
          value={productForm.priceNaira}
          onChange={(e) => setProductForm((f) => ({ ...f, priceNaira: e.target.value }))}
          className="w-28 rounded-md border border-dark-border px-3 py-2"
          min={1}
          required
        />
        <select
          value={productForm.categoryId}
          onChange={(e) => setProductForm((f) => ({ ...f, categoryId: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        >
          <option value="">Category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={productForm.brandId}
          onChange={(e) => setProductForm((f) => ({ ...f, brandId: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        >
          <option value="">Brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Unit (e.g. 50kg bag)"
          value={productForm.unit}
          onChange={(e) => setProductForm((f) => ({ ...f, unit: e.target.value }))}
          className="rounded-md border border-dark-border px-3 py-2"
          required
        />
        <input
          type="number"
          placeholder="Stock"
          value={productForm.stockQuantity}
          onChange={(e) => setProductForm((f) => ({ ...f, stockQuantity: e.target.value }))}
          className="w-24 rounded-md border border-dark-border px-3 py-2"
          min={0}
        />
        <button disabled={busy} className="rounded-md bg-primary px-4 py-2 font-semibold text-white">
          Add product (draft)
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-dark-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-primary-surface text-text-dark">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-dark-border">
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3">{formatNaira(p.priceKobo)}</td>
                <td className="px-4 py-3">{p.stockQuantity}</td>
                <td className="px-4 py-3 capitalize">{p.status}</td>
                <td className="px-4 py-3">
                  <button onClick={() => togglePublish(p)} className="text-sm text-primary">
                    {p.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
