"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, Phone, ShoppingBag } from "lucide-react";
import { loginDemoCustomer, loginDemoCustomerByPhone } from "@/lib/demo-account";

type LoginMethod = "email" | "phone";

export default function LoginPage() {
  const router = useRouter();
  const [method, setMethod] = useState<LoginMethod>("email");
  const [email, setEmail] = useState("demo@clickclickbuy.com");
  const [password, setPassword] = useState("ClickBuyDemo2026!");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) { setError("Enter your email address and password."); return; }
    loginDemoCustomer(email);
    router.replace("/account");
  }

  function requestDemoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = phone.replace(/\\D/g, "");
    if (digits.length < 10 || digits.length > 15) { setError("Enter a valid phone number, including your country code."); return; }
    setError("");
    setOtpRequested(true);
  }

  function verifyDemoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\\d{6}$/.test(otp)) { setError("Enter the 6-digit verification code."); return; }
    loginDemoCustomerByPhone(phone);
    router.replace("/account");
  }

  function selectMethod(next: LoginMethod) {
    setMethod(next);
    setError("");
    setNotice("");
    setOtpRequested(false);
    setOtp("");
  }

  return (
    <div className="customer-auth-page"><section className="customer-auth-card">
      <Link href="/" className="customer-auth-brand"><ShoppingBag size={25}/><span>ClickClick<strong>Buy</strong></span></Link>
      <p className="customer-auth-eyebrow">YOUR ACCOUNT</p><h1>Welcome back</h1>
      <p className="customer-auth-intro">Sign in your way. Your everyday finds are waiting.</p>
      <div className="customer-auth-socials">
        <button type="button" onClick={() => setNotice("Google sign-in will be enabled when secure authentication is connected.")} aria-label="Continue with Google"><span className="customer-auth-google-mark">G</span>Continue with Google</button>
        <button type="button" onClick={() => setNotice("Facebook sign-in will be enabled when secure authentication is connected.")} aria-label="Continue with Facebook"><span className="customer-auth-facebook-mark">f</span>Continue with Facebook</button>
      </div>
      <div className="customer-auth-divider"><span>OR CONTINUE WITH</span></div>
      <div className="customer-auth-methods" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "is-active" : ""} onClick={() => selectMethod("email")}><Mail size={15}/>Email</button>
        <button type="button" role="tab" aria-selected={method === "phone"} className={method === "phone" ? "is-active" : ""} onClick={() => selectMethod("phone")}><Phone size={15}/>Phone number</button>
      </div>
      {method === "email" ? (
        <form onSubmit={handleEmailSubmit} className="customer-auth-form">
          <label htmlFor="login-email">Email address</label><div className="customer-auth-input"><Mail size={18}/><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
          <label htmlFor="login-password">Password</label>
          <div className="customer-auth-input"><LockKeyhole size={18}/><input id="login-password" type={showPassword?"text":"password"} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">Sign In</button>
        </form>
      ) : (
        <form onSubmit={otpRequested ? verifyDemoCode : requestDemoCode} className="customer-auth-form">
          {!otpRequested ? <>
            <label htmlFor="login-phone">Mobile phone number</label><div className="customer-auth-input"><Phone size={18}/><input id="login-phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+234 801 234 5678"/></div>
            <p className="customer-auth-field-hint">Use your country code so we can identify the right number.</p>
          </> : <>
            <button type="button" className="customer-auth-back" onClick={() => {setOtpRequested(false);setOtp("");setError("");}}><ArrowLeft size={14}/> Change phone number</button>
            <p className="customer-auth-otp-copy">Enter the 6-digit code for <strong>{phone}</strong>.</p>
            <label htmlFor="login-otp">Verification code</label><input id="login-otp" className="customer-auth-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={e=>setOtp(e.target.value.replace(/\\D/g,"").slice(0,6))} placeholder="000000"/>
          </>}
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">{otpRequested ? "Verify and Sign In" : "Continue with Phone"}</button>
        </form>
      )}
      {notice && <p className="customer-auth-info" role="status">{notice}</p>}
      <div className="customer-demo-notice"><strong>Frontend prototype</strong><span>No real authentication or SMS is sent yet. Phone verification is a UI preview; any 6-digit code completes the demo sign-in. Google and Facebook will be connected during the backend authentication phase.</span></div>
      <p className="customer-auth-footnote">New to ClickClickBuy? <Link href="/register">Create an account</Link></p>
    </section></div>
  );
}
