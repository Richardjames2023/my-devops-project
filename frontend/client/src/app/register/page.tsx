"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest } from "@/lib/api/client";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string }>("/auth/register", { method: "POST", body: { ...form, phone: form.phone.trim() || undefined } });
      setMessage(result.message || "Account created. Check your email for a verification link before signing in.");
      window.setTimeout(() => router.replace("/login"), 3500);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "We couldn't create your account. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="customer-auth-page"><section className="customer-auth-card">
      <Link href="/" className="customer-auth-brand"><span>ClickClick<strong>Buy</strong></span></Link>
      <p className="customer-auth-eyebrow">JOIN CLICKCLICKBUY</p><h1>Create your account</h1>
      <p className="customer-auth-intro">Create an account to keep your orders and shopping details together.</p>
      <form onSubmit={submit} className="customer-auth-form">
        <div className="customer-auth-two-col"><div><label htmlFor="reg-first">First name</label><input id="reg-first" required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></div><div><label htmlFor="reg-last">Last name</label><input id="reg-last" required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></div></div>
        <label htmlFor="reg-email">Email address</label><input id="reg-email" type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
        <label htmlFor="reg-phone">Phone number <span>(optional)</span></label><input id="reg-phone" type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
        <label htmlFor="reg-password">Password</label><input id="reg-password" type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
        {error && <p className="customer-auth-error" role="alert">{error}</p>}{message && <p className="customer-auth-success" role="status">{message}</p>}
        <button className="customer-auth-submit" disabled={busy}>{busy ? "Creating account…" : "Create Account"}</button>
      </form><p className="customer-auth-footnote">Already have an account? <Link href="/login">Sign in</Link></p>
    </section></div>
  );
}
