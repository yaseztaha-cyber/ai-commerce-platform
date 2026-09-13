"use client";
import { useState } from "react";

const REQUIRED = ["name", "basePrice"];
const ALL_FIELDS = [
  "name", "nameAr", "description", "descriptionAr", "brand",
  "basePrice", "currency", "sku", "color", "size", "qty",
  "chest", "length", "shoulder", "sleeve", "imageUrl",
];

export default function CSVv2Import() {
  const [csvText, setCsvText] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, string | undefined>>({});
  const [preview, setPreview] = useState<{
    preview: Array<{ row: number; product: any; variant: any }>;
    totalRows: number;
    validRows: number;
    errors: Array<{ row: number; field?: string; message: string; raw?: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [success, setSuccess] = useState(false);
  const [_dryRun, setDryRun] = useState(true);

  async function loadTemplate() {
    const res = await fetch("/api/onboarding/csv-v2");
    const j = await res.json();
    if (j.ok) {
      const headers = j.data.headers.join(",");
      const sample = j.data.sampleRow.join(",");
      setCsvText(headers + "\n" + sample + "\n");
      // Auto-map headers
      const map: Record<string, string> = {};
      j.data.headers.forEach((h: string) => { map[h] = h; });
      setColumnMap(map);
    }
  }

  async function runPreview() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/onboarding/csv-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: csvText, columnMap, dryRun: true }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed");
      return;
    }
    setPreview(j.data);
    setDryRun(true);
    setMsg(`Preview: ${j.data.validRows}/${j.data.totalRows} valid rows, ${j.data.errors.length} errors`);
  }

  async function runImport() {
    if (!preview || preview.validRows === 0) {
      setMsg("No valid rows to import");
      return;
    }
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/onboarding/csv-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: csvText, columnMap, dryRun: false }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed");
      return;
    }
    setSuccess(true);
    setMsg(`Imported: ${j.data.productsCreated} products, ${j.data.variantsCreated} variants, ${j.data.measurementsCreated} measurements, ${j.data.imagesCreated} images`);
    setPreview(null);
    setCsvText("");
  }

  function renderMapping() {
    return (
      <div className="mt-4 card p-5">
        <h2 className="font-bold">Column mapping</h2>
        <p className="text-sm text-ink-500 mt-1">Map your CSV headers to expected fields. Unknown headers are ignored.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {ALL_FIELDS.map((field) => {
            const isRequired = REQUIRED.includes(field as any);
            return (
              <div key={field} className="flex items-center gap-2">
                <span className="text-xs text-ink-500 w-28">{field}{isRequired && <span className="text-red-500">*</span>}</span>
                <select
                  className="input text-xs flex-1"
                  value={columnMap[field] ?? ""}
                  onChange={(e) => setColumnMap({ ...columnMap, [field]: e.target.value || undefined })}
                >
                  <option value="">— Ignore —</option>
                  <option value="name">name</option>
                  <option value="nameAr">nameAr</option>
                  <option value="description">description</option>
                  <option value="descriptionAr">descriptionAr</option>
                  <option value="brand">brand</option>
                  <option value="basePrice">basePrice</option>
                  <option value="currency">currency</option>
                  <option value="sku">sku</option>
                  <option value="color">color</option>
                  <option value="size">size</option>
                  <option value="qty">qty</option>
                  <option value="chest">chest</option>
                  <option value="length">length</option>
                  <option value="shoulder">shoulder</option>
                  <option value="sleeve">sleeve</option>
                  <option value="imageUrl">imageUrl</option>
                </select>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">CSV v2 Import</h1>
      <p className="mt-1 text-sm text-ink-500">Column mapping preview, per-row error fixes, photo URLs. All-or-nothing transaction.</p>

      <div className="mt-4 flex gap-2">
        <button onClick={loadTemplate} className="btn-ghost text-sm">Load template</button>
        <button disabled={busy} onClick={runPreview} className="btn-primary text-sm">{busy ? "Previewing..." : "Preview (dry run)"}</button>
        <button disabled={busy || !preview || preview.validRows === 0} onClick={runImport} className="btn-primary text-sm">{busy ? "Importing..." : "Import for real"}</button>
      </div>

      {msg && <div className={`mt-4 card p-3 text-sm ${success ? "border-brand-200 bg-brand-50 text-brand-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg}</div>}

      <div className="mt-4">
        <label className="label">Paste CSV (max 2MB, 2000 rows)</label>
        <textarea
          className="input min-h-[300px] font-mono text-xs"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder="name,basePrice,sku,color,size,qty,imageUrl\nClassic Tee,29900,TEE-BLK-M,Black,M,10,https://example.com/tee.jpg"
        />
      </div>

      {renderMapping()}

      {preview && (
        <div className="mt-6 card p-5">
          <h2 className="font-bold">Preview: {preview.validRows}/{preview.totalRows} valid rows</h2>
          {preview.errors.length > 0 && (
            <div className="mt-3 text-sm text-red-600">
              Errors: {preview.errors.length} (showing first 20)
              <ul className="list-disc ps-5 mt-1">
                {preview.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row}{e.field ? ` (${e.field})` : ""}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Product</th>
                  <th>Variant</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.slice(0, 50).map((p, i) => (
                  <tr key={i}>
                    <td>{p.row}</td>
                    <td>{p.product.name} / {p.product.basePrice} {p.product.currency}</td>
                    <td>{p.variant?.color} / {p.variant?.size} / {p.variant?.sku || "auto"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.preview.length > 50 && <p className="mt-2 text-xs text-ink-500">Showing first 50 of {preview.preview.length} valid rows</p>}
          </div>
        </div>
      )}
    </main>
  );
}