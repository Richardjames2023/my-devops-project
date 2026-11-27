"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail, ShoppingBag } from "lucide-react";
import { loginDemoCustomer } from "@/lib/demo-account";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("demo@clickclickbuy.com");
  const [password, setPassword] = useState("ClickBuyDemo2026!");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) { setError("Enter your email address and password."); return; }
    loginDemoCustomer(email);
    router.replace("/account");
  }

  return (
    <div className="customer-auth-page"><section className="customer-auth-card">
      <Link href="/" className="customer-auth-brand"><ShoppingBag size={25}/><span>ClickClick<strong>Buy</strong></span></Link>
      <p className="customer-auth-eyebrow">YOUR ACCOUNT</p><h1>Welcome back</h1>
      <p className="customer-auth-intro">Sign in to explore your ClickClickBuy customer dashboard.</p>
      <div className="customer-demo-notice"><strong>Frontend demo mode</strong><span>Use the prefilled details or enter any email and password to preview the account experience. No backend request is made.</span></div>
      <form onSubmit={handleSubmit} className="customer-auth-form">
        <label htmlFor="login-email">Email address</label><div className="customer-auth-input"><Mail size={18}/><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
        <label htmlFor="login-password">Password</label><div className="customer-auth-input"><LockKeyhole size={18}/><input id="login-password" type={showPassword?"text":"password"} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        {error && <p className="customer-auth-error" role="alert">{error}</p>}
        <button className="customer-auth-submit" type="submit">Sign In</button>
      </form>
      <p className="customer-auth-footnote">New to ClickClickBuy? <Link href="/register">Create an account</Link></p>
    </section></div>
  );
}
