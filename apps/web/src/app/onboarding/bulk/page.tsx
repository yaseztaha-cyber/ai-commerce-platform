"use client";
import { useState } from "react";

const defaultColors = "Black,White,Gray,Navy,Red,Blue,Green,Pink";
const defaultSizes = "XS,S,M,L,XL,XXL";

export default function BulkGenerate() {
  const [form, setForm] = useState({
    productName: "",
    nameAr: "",
    basePrice: 29900,
    colors: defaultColors,
    sizes: defaultSizes,
    quantityPerVariant: 10,
    skuPrefix: "",
  });
  const [preview, setPreview] = useState<{ matrix: Array<{ color: string; size: string; sku: string }>; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [success, setSuccess] = useState(false);

  async function loadPreview() {
    setMsg("");
    const params = new URLSearchParams({
      productName: form.productName,
      basePrice: String(form.basePrice),
      colors: form.colors,
      sizes: form.sizes,
      quantityPerVariant: String(form.quantityPerVariant),
      skuPrefix: form.skuPrefix,
    });
    const res = await fetch(`/api/onboarding/bulk-generate?${params}`);
    const j = await res.json();
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed to load preview");
      return;
    }
    setPreview(j.data);
  }

  async function submit() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/onboarding/bulk-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, dryRun: false }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed to create");
      return;
    }
    setSuccess(true);
    setMsg(`Created product "${j.data.product.name}" with ${j.data.total} variants!`);
    setPreview(null);
    setForm({ ...form, productName: "", nameAr: "" });
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Bulk Variant Generator</h1>
      <p className="mt-1 text-sm text-ink-500">Create a full color × size matrix in one click. SKUs auto-generated and collision-checked.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-bold">Product</h2>
          <label className="label mt-4">Product name *</label>
          <input className="input" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="Classic Tee" />
          <label className="label mt-4">Arabic name</label>
          <input className="input" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} placeholder="تيشيرت كلاسيك" />
          <label className="label mt-4">Base price (EGP, minor units) *</label>
          <input className="input" type="number" min={0} value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: Number(e.target.value) })} />
        </div>

        <div className="card p-5">
          <h2 className="font-bold">Variants</h2>
          <label className="label mt-4">Colors (comma-separated) *</label>
          <textarea className="input min-h-[80px]" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} placeholder="Black,White,Gray,Navy,Red" />
          <label className="label mt-4">Sizes (comma-separated) *</label>
          <textarea className="input min-h-[80px]" value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} placeholder="XS,S,M,L,XL,XXL" />
          <label className="label mt-4">Qty per variant</label>
          <input className="input" type="number" min={0} value={form.quantityPerVariant} onChange={(e) => setForm({ ...form, quantityPerVariant: Number(e.target.value) })} />
          <label className="label mt-4">SKU prefix (optional, max 10 chars)</label>
          <input className="input" maxLength={10} value={form.skuPrefix} onChange={(e) => setForm({ ...form, skuPrefix: e.target.value })} placeholder="Auto from product name" />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button disabled={busy || !form.productName || !form.colors || !form.sizes} onClick={loadPreview} className="btn-ghost text-sm">
          {busy ? "Loading..." : "Preview matrix"}
        </button>
        <button disabled={busy || !preview} onClick={submit} className="btn-primary text-sm">
          {busy ? "Creating..." : "Create all variants"}
        </button>
      </div>

      {msg && <div className={`mt-4 card p-3 text-sm ${success ? "border-brand-200 bg-brand-50 text-brand-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg}</div>}

      {preview && (
        <div className="mt-6 card p-5">
          <h2 className="font-bold">Preview: {preview.total} variants</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Size</th>
                  <th>SKU</th>
                </tr>
              </thead>
              <tbody>
                {preview.matrix.map((v, i) => (
                  <tr key={i}>
                    <td>{v.color}</td>
                    <td>{v.size}</td>
                    <td><code className="text-xs">{v.sku}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}