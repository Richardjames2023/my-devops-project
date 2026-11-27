"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail, ShoppingBag } from "lucide-react";
import { ApiError, apiRequest, setAuthTokens } from "@/lib/api/client";

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; firstName: string; lastName: string };
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), password },
      });
      setAuthTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      router.replace(new URLSearchParams(window.location.search).get("next")?.startsWith("/") ? new URLSearchParams(window.location.search).get("next")! : "/account");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "We couldn't sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="customer-auth-page">
      <section className="customer-auth-card">
        <Link href="/" className="customer-auth-brand"><ShoppingBag size={25} /><span>ClickClick<strong>Buy</strong></span></Link>
        <p className="customer-auth-eyebrow">YOUR ACCOUNT</p>
        <h1>Welcome back</h1>
        <p className="customer-auth-intro">Sign in to manage your orders, saved items and account details.</p>
        <form onSubmit={handleSubmit} className="customer-auth-form">
          <label htmlFor="login-email">Email address</label>
          <div className="customer-auth-input"><Mail size={18} /><input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div>
          <label htmlFor="login-password">Password</label>
          <div className="customer-auth-input"><LockKeyhole size={18} /><input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit" disabled={busy}>{busy ? "Signing you in…" : "Sign In"}</button>
        </form>
        <p className="customer-auth-footnote">New to ClickClickBuy? <Link href="/register">Create an account</Link></p>
      </section>
    </div>
  );
}
