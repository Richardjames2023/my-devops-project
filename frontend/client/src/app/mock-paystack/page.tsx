"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, LockKeyhole, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

function MockPaystackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const rawAmount = Number(params.get("amount") ?? 0);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  const reference = params.get("reference") || "CCB-DEMO";

  const finish = (status: "success" | "failed") => {
    const query = new URLSearchParams({ step: "4", mockStatus: status, reference });
    router.push(`/cart?${query.toString()}`);
  };

  return (
    <main className="mock-paystack-page">
      <header className="mock-paystack-topbar">
        <Link href="/cart?step=3" className="mock-paystack-back"><ArrowLeft size={16}/> Back to ClickClickBuy</Link>
        <div className="mock-paystack-brand"><span>paystack</span><small>DEMO CHECKOUT</small></div>
        <span className="mock-paystack-lock"><LockKeyhole size={14}/> Simulated gateway</span>
      </header>
      <div className="mock-paystack-content">
        <div className="mock-paystack-demo-alert"><ShieldCheck size={17}/><span>This is a mock payment page for storefront testing. No real payment details should be entered and no money will be charged.</span></div>
        <section className="mock-paystack-panel">
          <div className="mock-paystack-merchant"><span className="mock-paystack-merchant-mark">C</span><div><strong>ClickClickBuy</strong><small>Payment checkout</small></div></div>
          <div className="mock-paystack-amount"><span>You&apos;re paying</span><strong>{formatNaira(amount)}</strong><small>NGN · Nigerian Naira</small></div>
          <div className="mock-paystack-reference"><span>Payment reference</span><strong>{reference}</strong></div>
          <div className="mock-paystack-method"><CreditCard size={19}/><div><strong>Card payment</strong><small>Simulated card payment option</small></div><span>DEMO</span></div>
          <div className="mock-paystack-simulate">
            <h2>Simulate the payment outcome</h2>
            <p>Choose the result to preview how ClickClickBuy responds after Paystack sends its payment notification.</p>
            <button type="button" className="mock-paystack-success" onClick={() => finish("success")}><CheckCircle2 size={18}/> Simulate successful payment <ArrowRight size={17}/></button>
            <button type="button" className="mock-paystack-failure" onClick={() => finish("failed")}><XCircle size={18}/> Simulate failed or cancelled payment</button>
          </div>
          <p className="mock-paystack-footer">In production, Paystack handles the payment and the backend webhook remains the source of truth for the final payment status.</p>
        </section>
        <Link href="/cart?step=3" className="mock-paystack-cancel">Cancel and return to ClickClickBuy</Link>
      </div>
    </main>
  );
}

export default function MockPaystackPage() {
  return <Suspense fallback={<div className="cart-loading">Loading secure checkout…</div>}><MockPaystackContent/></Suspense>;
}
