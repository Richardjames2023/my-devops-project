"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerDemoCustomer } from "@/lib/demo-account";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.password.length < 8) { setError("For this demo, use a password with at least 8 characters."); return; }
    registerDemoCustomer({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() });
    router.replace("/account");
  }

  return (
    <div className="customer-auth-page"><section className="customer-auth-card">
      <Link href="/" className="customer-auth-brand"><span>ClickClick<strong>Buy</strong></span></Link>
      <p className="customer-auth-eyebrow">JOIN CLICKCLICKBUY</p><h1>Create your account</h1>
      <p className="customer-auth-intro">Create a demo account to explore the customer experience.</p>
      <div className="customer-demo-notice"><strong>Frontend demo mode</strong><span>Your details stay in this browser for the prototype. This form does not create a real customer account or contact the backend.</span></div>
      <form onSubmit={submit} className="customer-auth-form">
        <div className="customer-auth-two-col"><div><label htmlFor="reg-first">First name</label><input id="reg-first" autoComplete="given-name" required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></div><div><label htmlFor="reg-last">Last name</label><input id="reg-last" autoComplete="family-name" required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></div></div>
        <label htmlFor="reg-email">Email address</label><input id="reg-email" type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
        <label htmlFor="reg-phone">Phone number <span>(optional)</span></label><input id="reg-phone" type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
        <label htmlFor="reg-password">Password</label><input id="reg-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
        {error && <p className="customer-auth-error" role="alert">{error}</p>}
        <button className="customer-auth-submit" type="submit">Create Demo Account</button>
      </form><p className="customer-auth-footnote">Already exploring ClickClickBuy? <Link href="/login">Sign in</Link></p>
    </section></div>
  );
}
