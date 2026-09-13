"use client";
import { useState, useEffect } from "react";

type Step = 1 | 2 | 3;

interface Step1Data {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  brand: string;
  basePrice: number;
  currency: string;
  quantity: number;
}

interface Step2Data {
  colors: string;
  sizes: string;
  quantityPerVariant: number;
  skuPrefix: string;
}

interface Step3Data {
  imageUrls: string;
}

export default function QuickAddWizard() {
  const [step, setStep] = useState<Step>(1);
  const [productId, setProductId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [success, setSuccess] = useState(false);

  const [s1, setS1] = useState<Step1Data>({
    name: "", nameAr: "", description: "", descriptionAr: "", brand: "", basePrice: 29900, currency: "EGP", quantity: 10,
  });
  const [s2, setS2] = useState<Step2Data>({ colors: "Black,White,Gray", sizes: "S,M,L,XL", quantityPerVariant: 5, skuPrefix: "" });
  const [s3, setS3] = useState<Step3Data>({ imageUrls: "" });

  // Resume from productId query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get("productId");
    if (pid) {
      setProductId(pid);
      resume(pid);
    }
  }, []);

  async function resume(pid: string) {
    setBusy(true);
    const res = await fetch(`/api/onboarding/quick-add?productId=${pid}`);
    const j = await res.json();
    setBusy(false);
    if (j.ok) {
      if (j.data.hasVariants) {
        setStep(j.data.hasImages ? 3 : 2);
      } else {
        setStep(1);
      }
    }
  }

  async function submitStep1() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/onboarding/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "1", data: s1 }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed");
      return;
    }
    setProductId(j.data.product.id);
    setMsg(`Product created! Add variants next.`);
    setStep(2);
  }

  async function submitStep2() {
    if (!productId) return;
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/onboarding/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "2", data: { ...s2, productId } }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed");
      return;
    }
    setMsg(`Created ${j.data.created.length} variants! Add photos next.`);
    setStep(3);
  }

  async function submitStep3() {
    if (!productId) return;
    setBusy(true);
    setMsg("");
    const urls = s3.imageUrls.split(",").map((u) => u.trim()).filter(Boolean);
    const res = await fetch("/api/onboarding/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "3", data: { productId, imageUrls: urls } }),
    });
    const j = await res.json();
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error?.message ?? "Failed");
      return;
    }
    setMsg("All done! Product is live with variants and photos.");
    setSuccess(true);
    setTimeout(() => { window.location.href = `/dashboard/products`; }, 1500);
  }

  function renderStep1() {
    return (
      <div className="space-y-4">
        <h2 className="font-bold">Step 1: Product basics</h2>
        <label className="label">Product name *</label>
        <input className="input" value={s1.name} onChange={(e) => setS1({ ...s1, name: e.target.value })} placeholder="Classic Tee" />
        <label className="label">Arabic name</label>
        <input className="input" value={s1.nameAr} onChange={(e) => setS1({ ...s1, nameAr: e.target.value })} placeholder="تيشيرت كلاسيك" />
        <label className="label">Description</label>
        <textarea className="input min-h-[80px]" value={s1.description} onChange={(e) => setS1({ ...s1, description: e.target.value })} />
        <label className="label">Arabic description</label>
        <textarea className="input min-h-[80px]" value={s1.descriptionAr} onChange={(e) => setS1({ ...s1, descriptionAr: e.target.value })} />
        <label className="label">Brand</label>
        <input className="input" value={s1.brand} onChange={(e) => setS1({ ...s1, brand: e.target.value })} />
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label">Base price (minor units) *</label>
            <input className="input" type="number" min={0} value={s1.basePrice} onChange={(e) => setS1({ ...s1, basePrice: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Currency</label>
            <input className="input" value={s1.currency} onChange={(e) => setS1({ ...s1, currency: e.target.value })} />
          </div>
        </div>
        <label className="label">Initial quantity (creates "One Size" variant)</label>
        <input className="input" type="number" min={0} value={s1.quantity} onChange={(e) => setS1({ ...s1, quantity: Number(e.target.value) })} />
        <button disabled={busy || !s1.name || s1.basePrice <= 0} onClick={submitStep1} className="btn-primary">
          {busy ? "Creating..." : "Create product →"}
        </button>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div className="space-y-4">
        <h2 className="font-bold">Step 2: Variants (color × size)</h2>
        <label className="label">Colors (comma-separated) *</label>
        <textarea className="input min-h-[80px]" value={s2.colors} onChange={(e) => setS2({ ...s2, colors: e.target.value })} placeholder="Black,White,Gray,Navy,Red" />
        <label className="label">Sizes (comma-separated) *</label>
        <textarea className="input min-h-[80px]" value={s2.sizes} onChange={(e) => setS2({ ...s2, sizes: e.target.value })} placeholder="S,M,L,XL" />
        <label className="label">Qty per variant</label>
        <input className="input" type="number" min={0} value={s2.quantityPerVariant} onChange={(e) => setS2({ ...s2, quantityPerVariant: Number(e.target.value) })} />
        <label className="label">SKU prefix (optional)</label>
        <input className="input" value={s2.skuPrefix} onChange={(e) => setS2({ ...s2, skuPrefix: e.target.value })} maxLength={10} />
        <div className="flex gap-2">
          <button onClick={() => setStep(1)} className="btn-ghost">← Back</button>
          <button disabled={busy || !s2.colors || !s2.sizes} onClick={submitStep2} className="btn-primary">
            {busy ? "Creating..." : "Create variants →"}
          </button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className="space-y-4">
        <h2 className="font-bold">Step 3: Product photos</h2>
        <p className="text-sm text-ink-500">Paste image URLs (comma-separated). Fetched server-side, validated as images ≤10MB.</p>
        <label className="label">Image URLs</label>
        <textarea className="input min-h-[80px]" value={s3.imageUrls} onChange={(e) => setS3({ ...s3, imageUrls: e.target.value })} placeholder="https://example.com/img1.jpg, https://example.com/img2.jpg" />
        <div className="flex gap-2">
          <button onClick={() => setStep(2)} className="btn-ghost">← Back</button>
          <button disabled={busy} onClick={submitStep3} className="btn-primary">
            {busy ? "Finishing..." : "Finish & go to products"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Quick-Add Wizard</h1>
      <p className="mt-1 text-sm text-ink-500">3 steps: Basics → Variants → Photos. Each step skippable.</p>

      <div className="mt-4 flex gap-1">
        {[1, 2, 3].map((s) => (
          <button key={s} onClick={() => s <= step && setStep(s as Step)} className={`btn-ghost text-xs flex-1 ${step === s ? "bg-brand-50 border-brand-200" : ""}`}>
            Step {s} {["Basics", "Variants", "Photos"][s - 1]}
          </button>
        ))}
      </div>

      {msg && <div className={`mt-4 card p-3 text-sm ${success ? "border-brand-200 bg-brand-50 text-brand-800" : "border-red-200 bg-red-50 text-red-800"}`}>{msg}</div>}

      <div className="mt-6 card p-6">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </div>
    </main>
  );
}