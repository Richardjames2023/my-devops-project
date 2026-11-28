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
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) { setError("Enter a valid phone number, including your country code."); return; }
    setError("");
    setOtpRequested(true);
  }

  function verifyDemoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError("Enter the 6-digit verification code."); return; }
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
      <div className="customer-auth-card-heading customer-auth-card-heading--center">
        <div className="customer-auth-join">
          <ShoppingBag size={23} strokeWidth={2.2} aria-hidden="true" />
          <span>JOIN CLICKCLICKBUY</span>
        </div>
      </div>
      <h1>Welcome back</h1>
      <p className="customer-auth-intro">Sign in your way. Your everyday finds are waiting.</p>
      <div className="customer-auth-socials">
        <button type="button" onClick={() => setNotice("Google sign-in will be enabled when secure authentication is connected.")} aria-label="Continue with Google"><svg className="customer-auth-provider-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.91c-.58 2.96-2.25 5.48-4.73 7.18l7.65 5.94c4.47-4.13 7.15-10.21 7.15-17.59Z"/>
            <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.86l-7.65-5.94c-2.13 1.45-4.86 2.3-8.25 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
          </svg>Continue with Google</button>
        <button type="button" onClick={() => setNotice("Facebook sign-in will be enabled when secure authentication is connected.")} aria-label="Continue with Facebook"><svg className="customer-auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.86v-8.39H7.08V12h3.045V9.35c0-3.005 1.79-4.665 4.53-4.665 1.312 0 2.685.234 2.685.234v2.95h-1.513c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.47h-2.796v8.39A12.002 12.002 0 0 0 24 12Z"/>
          </svg>Continue with Facebook</button>
      </div>
      <div className="customer-auth-divider"><span>OR CONTINUE WITH</span></div>
      <div className="customer-auth-methods" role="tablist" aria-label="Sign-in method">
        <button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "is-active" : ""} onClick={() => selectMethod("email")}><Mail size={15}/>Email</button>
        <button type="button" role="tab" aria-selected={method === "phone"} className={method === "phone" ? "is-active" : ""} onClick={() => selectMethod("phone")}><Phone size={15}/>Phone number</button>
      </div>
      {method === "email" ? (
        <form key="email-login" onSubmit={handleEmailSubmit} className="customer-auth-form customer-auth-panel-enter">
          <label htmlFor="login-email">Email address</label><div className="customer-auth-input"><Mail size={18}/><input id="login-email" type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
          <label htmlFor="login-password">Password</label>
          <div className="customer-auth-input"><LockKeyhole size={18}/><input id="login-password" type={showPassword?"text":"password"} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">Sign In</button>
        </form>
      ) : (
        <form key={otpRequested ? "phone-verify" : "phone-entry"} onSubmit={otpRequested ? verifyDemoCode : requestDemoCode} className="customer-auth-form customer-auth-panel-enter">
          {!otpRequested ? <>
            <label htmlFor="login-phone">Mobile phone number</label><div className="customer-auth-input"><Phone size={18}/><input id="login-phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+234 801 234 5678"/></div>
            <p className="customer-auth-field-hint">Use your country code so we can identify the right number.</p>
          </> : <>
            <button type="button" className="customer-auth-back" onClick={() => {setOtpRequested(false);setOtp("");setError("");}}><ArrowLeft size={14}/> Change phone number</button>
            <p className="customer-auth-otp-copy">Enter the 6-digit code for <strong>{phone}</strong>.</p>
            <label htmlFor="login-otp">Verification code</label><input id="login-otp" className="customer-auth-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000"/>
          </>}
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">{otpRequested ? "Verify and Sign In" : "Continue with Phone"}</button>
        </form>
      )}
      {notice && <p className="customer-auth-info customer-auth-panel-enter" role="status">{notice}</p>}
      
      <p className="customer-auth-footnote">New to ClickClickBuy? <Link href="/register">Create an account</Link></p>
    </section></div>
  );
}
