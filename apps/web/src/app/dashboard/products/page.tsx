"use client";
import { useState, type FormEvent, Fragment } from "react";
import { useApi, Loading, Err, Empty, formatEGP } from "@/components/ui";

export default function Products() {
  const { data, loading, error } = useApi<{ products: Array<{ id: string; name: string; nameAr?: string | null; basePrice: number; active: boolean; images: Array<{ id: string; url: string; alt?: string | null }>; variants: Array<{ id: string; sku: string; price?: number | null; active: boolean; attributes: Record<string, string>; inventory?: { quantity: number } | null }> }> }>("/api/products");
  const [form, setForm] = useState({ name: "", nameAr: "", basePrice: "450", quantity: "" });
  const [msg, setMsg] = useState("");
  const [importResult, setImportResult] = useState("");
  const [openVariant, setOpenVariant] = useState<string | null>(null);
  const [openMeasures, setOpenMeasures] = useState<string | null>(null);
  const [vform, setVform] = useState({ color: "Black", size: "M", sku: "", price: "", quantity: "0" });
  const [vmsg, setVmsg] = useState("");
  const [editVariant, setEditVariant] = useState<string | null>(null);
  const [eform, setEform] = useState({ price: "", active: true });
  const [emsg, setEmsg] = useState("");
  const [editProduct, setEditProduct] = useState<string | null>(null);
  const [pform, setPform] = useState({ name: "", nameAr: "", brand: "", basePrice: "", active: true });
  const [pmsg, setPmsg] = useState("");
  const [pbusy, setPbusy] = useState(false);

  async function saveProductEdit(productId: string) {
    setPbusy(true);
    setPmsg("");
    const r = await fetch(`/api/products/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: pform.name.trim() || undefined,
        nameAr: pform.nameAr.trim() || null,
        brand: pform.brand.trim() || null,
        basePrice: pform.basePrice === "" ? undefined : Number(pform.basePrice),
        active: pform.active,
      }),
    });
    const j = await r.json();
    setPbusy(false);
    if (!j.ok) {
      setPmsg(j?.error?.message ?? "Failed");
      return;
    }
    window.location.reload();
  }

  function startProductEdit(p: { id: string; name: string; nameAr?: string | null; basePrice: number; brand?: string | null; active: boolean }) {
    setPform({ name: p.name, nameAr: p.nameAr ?? "", brand: p.brand ?? "", basePrice: String(p.basePrice), active: p.active });
    setEditProduct(editProduct === p.id ? null : p.id);
    setPmsg("");
  }

  async function archiveProduct(p: { id: string; name: string; active: boolean }) {
    if (!confirm(p.active ? `Archive "${p.name}"? It will stop being offered to customers.` : `Re-enable "${p.name}"?`)) return;
    const r = await fetch(`/api/products/${p.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !p.active }) });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function saveVariantEdit(variantId: string) {
    setEmsg("");
    const r = await fetch(`/api/variants/${variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        price: eform.price === "" ? null : Number(eform.price),
        active: eform.active,
      }),
    });
    const j = await r.json();
    if (!j.ok) {
      setEmsg(j?.error?.message ?? "Failed");
      return;
    }
    window.location.reload();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const qty = form.quantity === "" ? undefined : Math.max(0, Math.floor(Number(form.quantity) || 0));
    const r = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, nameAr: form.nameAr || undefined, basePrice: Number(form.basePrice), quantity: qty }) });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function uploadImage(productId: string, file: File) {
    setMsg("");
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/api/products/${productId}/images`, { method: "POST", body: form });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Upload failed");
    else window.location.reload();
  }

  async function deleteImage(imageId: string) {
    if (!confirm("Delete this image?")) return;
    await fetch(`/api/images/${imageId}`, { method: "DELETE" });
    window.location.reload();
  }

  async function createVariant(e: FormEvent, productId: string) {
    e.preventDefault();
    setVmsg("");
    const qty = Math.max(0, Math.floor(Number(vform.quantity) || 0));
    const r = await fetch("/api/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        sku: vform.sku.trim(),
        price: vform.price === "" ? null : Number(vform.price),
        attributes: { Color: vform.color.trim() || "Black", Size: vform.size.trim() || "M" },
        quantity: qty,
      }),
    });
    const j = await r.json();
    if (!j.ok) {
      setVmsg(j?.error?.message ?? JSON.stringify(j?.error?.details ?? "Failed"));
      return;
    }
    window.location.reload();
  }

  async function importCsv(file: File, dryRun: boolean) {
    setImportResult(dryRun ? "Validating…" : "Importing…");
    const text = await file.text();
    const r = await fetch(`/api/products/import${dryRun ? "?dryRun=1" : ""}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
    const j = await r.json();
    if (!j.ok) {
      setImportResult(`Failed: ${j?.error?.message ?? "error"}`);
      return;
    }
    const d = j.data;
    const errLines = (d.errors ?? []).slice(0, 5).map((e: { row: number; message: string }) => `row ${e.row}: ${e.message}`).join("; ");
    setImportResult(
      `${dryRun ? "Preview" : "Imported"}: ${d.productsCreated} products, ${d.variantsUpserted} variants, ${d.errors.length} errors${errLines ? ` — ${errLines}` : ""}`
    );
    if (!dryRun && d.errors.length === 0) window.location.reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Err message={error || "Failed"} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold tracking-tight">Products</h1>
        <div className="flex items-center gap-2">
          <a className="btn-ghost text-xs" href="/api/products/import" download="products.csv">Export CSV</a>
          <label className="btn-ghost cursor-pointer text-xs">
            Preview CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f, true); e.target.value = ""; }} />
          </label>
          <label className="btn-ghost cursor-pointer text-xs">
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && confirm("Import this CSV into live products?")) importCsv(f, false); e.target.value = ""; }} />
          </label>
        </div>
      </div>
      {importResult && <div className="card p-3 text-sm">{importResult}</div>}
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className="label">Arabic name</label><input className="input" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></div>
        <div><label className="label">Price (EGP)</label><input className="input w-28" type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required /></div>
        <div><label className="label">Quantity</label><input className="input w-24" type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" title="Creates a One Size variant with this stock" /></div>
        <button className="btn-primary">Add product</button>
        {msg && <span className="text-sm text-red-700">{msg}</span>}
      </form>
      {data.products.length === 0 && <Empty title="No products" hint="Add your first product above." />}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Product</th><th>Price</th><th>Variants (SKU · attributes · stock)</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.products.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  <td>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-ink-500">{p.nameAr}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {(p.images ?? []).map((img) => (
                        <span key={img.id} className="group relative inline-block">
                          <img src={img.url} alt={img.alt ?? p.name} className="h-10 w-10 rounded border border-ink-100 object-cover" loading="lazy" />
                          <button title="Delete image" className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-red-700 text-[10px] text-white group-hover:flex" onClick={() => deleteImage(img.id)}>×</button>
                        </span>
                      ))}
                      <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded border border-dashed border-ink-300 text-lg text-ink-300 hover:border-brand-600 hover:text-brand-600" title="Upload image (jpeg/png/webp, ≤5MB)">
                        +
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(p.id, f); e.target.value = ""; }} />
                      </label>
                    </div>
                  </td>
                  <td className="tabular-nums">{formatEGP(p.basePrice)}</td>
                  <td className="max-w-[460px] text-xs">
                    {p.variants.length === 0 && <span className="text-ink-300">No variants yet</span>}
                    <ul className="space-y-1">
                      {p.variants.map((v) => (
                        <li key={v.id}>
                          <span className={v.active ? "" : "text-ink-300 line-through"}>
                            {v.sku} ({Object.values(v.attributes).join("/")}): {v.inventory?.quantity ?? 0}
                            {v.price != null && v.price !== p.basePrice ? ` @ ${v.price}` : ""}
                            {!v.active ? " (off)" : ""}
                          </span>{" "}
                          <button
                            className="text-[11px] text-brand-700 hover:underline"
                            onClick={() => { setEditVariant(editVariant === v.id ? null : v.id); setEform({ price: v.price != null ? String(v.price) : "", active: v.active }); setEmsg(""); }}
                          >
                            Edit
                          </button>
                          {editVariant === v.id && (
                            <span className="mt-1 flex flex-wrap items-center gap-2 rounded bg-ink-50 p-2">
                              <label className="text-[11px]">Price <input className="input w-20 py-1 text-xs" type="number" min={0} placeholder={`${p.basePrice}`} value={eform.price} onChange={(e) => setEform({ ...eform, price: e.target.value })} /></label>
                              <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={eform.active} onChange={(e) => setEform({ ...eform, active: e.target.checked })} /> Active</label>
                              <button className="btn-primary px-2 py-1 text-[11px]" onClick={() => saveVariantEdit(v.id)}>Save</button>
                              {emsg && <span className="text-[11px] text-red-700">{emsg}</span>}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{p.active ? <span className="badge-green">Active</span> : <span className="badge-gray">Off</span>}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-ghost mr-1 px-2 py-1 text-xs" onClick={() => { setOpenVariant(openVariant === p.id ? null : p.id); setVmsg(""); }}>+ Variant</button>
                    <button className="btn-ghost mr-1 px-2 py-1 text-xs" onClick={() => { setOpenMeasures(openMeasures === p.id ? null : p.id); }}>Sizes</button>
                    <button className="btn-ghost mr-1 px-2 py-1 text-xs" onClick={() => startProductEdit(p)}>Edit</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => archiveProduct(p)}>{p.active ? "Archive" : "Re-enable"}</button>
                  </td>
                </tr>
                {openMeasures === p.id && (
                  <tr key={`${p.id}-measures`}>
                    <td colSpan={5} className="bg-ink-50/60">
                      <MeasuresEditor productId={p.id} productName={p.name} />
                    </td>
                  </tr>
                )}
                {openVariant === p.id && (
                  <tr key={`${p.id}-form`}>
                    <td colSpan={5} className="bg-ink-50/60">
                      <form onSubmit={(e) => createVariant(e, p.id)} className="flex flex-wrap items-end gap-3 p-2">
                        <div><label className="label">Color</label><input className="input w-28" value={vform.color} onChange={(e) => setVform({ ...vform, color: e.target.value })} required /></div>
                        <div><label className="label">Size</label><input className="input w-20" value={vform.size} onChange={(e) => setVform({ ...vform, size: e.target.value })} required /></div>
                        <div><label className="label">SKU</label><input className="input w-36" value={vform.sku} onChange={(e) => setVform({ ...vform, sku: e.target.value })} required placeholder="OVER-BLA-XXL" /></div>
                        <div><label className="label">Price (blank = {p.basePrice})</label><input className="input w-28" type="number" min={0} value={vform.price} onChange={(e) => setVform({ ...vform, price: e.target.value })} /></div>
                        <div><label className="label">Quantity</label><input className="input w-24" type="number" min={0} value={vform.quantity} onChange={(e) => setVform({ ...vform, quantity: e.target.value })} required /></div>
                        <button className="btn-primary px-3 py-2 text-xs">Save variant + stock</button>
                        {vmsg && <span className="text-xs text-red-700">{vmsg}</span>}
                      </form>
                    </td>
                  </tr>
                )}
                {editProduct === p.id && (
                  <tr key={`${p.id}-edit`}>
                    <td colSpan={5} className="bg-ink-50/60">
                      <div className="flex flex-wrap items-end gap-3 p-2">
                        <div><label className="label">Name</label><input className="input w-44" value={pform.name} onChange={(e) => setPform({ ...pform, name: e.target.value })} /></div>
                        <div><label className="label">Arabic name</label><input className="input w-36" value={pform.nameAr} onChange={(e) => setPform({ ...pform, nameAr: e.target.value })} /></div>
                        <div><label className="label">Brand</label><input className="input w-32" value={pform.brand} onChange={(e) => setPform({ ...pform, brand: e.target.value })} /></div>
                        <div><label className="label">Price (EGP)</label><input className="input w-24" type="number" min={0} value={pform.basePrice} onChange={(e) => setPform({ ...pform, basePrice: e.target.value })} /></div>
                        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={pform.active} onChange={(e) => setPform({ ...pform, active: e.target.checked })} /> Active</label>
                        <button className="btn-primary px-3 py-2 text-xs" disabled={pbusy} onClick={() => saveProductEdit(p.id)}>Save</button>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditProduct(null)}>Cancel</button>
                        {pmsg && <span className="text-xs text-red-700">{pmsg}</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MeasuresEditor({ productId, productName }: { productId: string; productName: string }) {
  const { data, loading } = useApi<{ measurements: Array<{ size: string; chest: number | null; length: number | null; shoulder: number | null; sleeve: number | null }> }>(`/api/products/${productId}/measurements`);
  const [f, setF] = useState({ size: "", chest: "", length: "", shoulder: "", sleeve: "" });
  const [msg, setMsg] = useState("");

  const num = (v: string) => (v === "" ? null : Number(v));

  async function save() {
    setMsg("");
    if (!f.size.trim()) {
      setMsg("Size is required.");
      return;
    }
    const r = await fetch(`/api/products/${productId}/measurements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: f.size.trim(), chest: num(f.chest), length: num(f.length), shoulder: num(f.shoulder), sleeve: num(f.sleeve) }),
    });
    const j = await r.json();
    if (!j.ok) setMsg(j?.error?.message ?? "Failed");
    else window.location.reload();
  }

  async function remove(size: string) {
    if (!confirm(`Delete measurements for size ${size}?`)) return;
    await fetch(`/api/products/${productId}/measurements?size=${encodeURIComponent(size)}`, { method: "DELETE" });
    window.location.reload();
  }

  return (
    <div className="space-y-2 p-2">
      <div className="text-xs font-semibold text-ink-500">Size table for {productName} (cm) — powers AI size advice</div>
      {loading && <div className="text-xs text-ink-300">Loading…</div>}
      {data && data.measurements.length > 0 && (
        <table className="table max-w-xl">
          <thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th><th>Sleeve</th><th></th></tr></thead>
          <tbody>
            {data.measurements.map((m) => (
              <tr key={m.size}>
                <td className="font-semibold">{m.size}</td>
                <td className="tabular-nums">{m.chest ?? "—"}</td>
                <td className="tabular-nums">{m.length ?? "—"}</td>
                <td className="tabular-nums">{m.shoulder ?? "—"}</td>
                <td className="tabular-nums">{m.sleeve ?? "—"}</td>
                <td><button className="text-[11px] text-red-700 hover:underline" onClick={() => remove(m.size)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label">Size</label><input className="input w-20" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder="M" /></div>
        {(["chest", "length", "shoulder", "sleeve"] as const).map((k) => (
          <div key={k}><label className="label">{k[0].toUpperCase() + k.slice(1)}</label><input className="input w-20" type="number" min={0} max={300} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
        ))}
        <button className="btn-primary px-3 py-2 text-xs" onClick={save}>Save row</button>
        {msg && <span className="text-xs text-red-700">{msg}</span>}
      </div>
    </div>
  );
}
