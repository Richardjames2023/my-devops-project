"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Phone, ShoppingBag } from "lucide-react";
import { registerDemoCustomer, registerDemoCustomerByPhone } from "@/lib/demo-account";

type RegistrationMethod = "email" | "phone";

export default function RegisterPage() {
  const router = useRouter();
  const [method, setMethod] = useState<RegistrationMethod>("email");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [otp, setOtp] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.password.length < 8) { setError("Use a password with at least 8 characters."); return; }
    registerDemoCustomer({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim().toLowerCase(), phone: form.phone.trim() });
    router.replace("/account");
  }

  function requestPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = form.phone.replace(/\D/g, "");
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("Enter your first and last name."); return; }
    if (digits.length < 10 || digits.length > 15) { setError("Enter a valid phone number, including your country code."); return; }
    setError("");
    setOtpRequested(true);
  }

  function verifyPhoneCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError("Enter the 6-digit verification code."); return; }
    registerDemoCustomerByPhone({ firstName: form.firstName, lastName: form.lastName, phone: form.phone });
    router.replace("/account");
  }

  function selectMethod(next: RegistrationMethod) {
    setMethod(next); setError(""); setNotice(""); setOtpRequested(false); setOtp("");
  }

  return (
    <div className="customer-auth-page"><section className="customer-auth-card">
      <Link href="/" className="customer-auth-brand"><ShoppingBag size={25}/><span>ClickClick<strong>Buy</strong></span></Link>
      <p className="customer-auth-eyebrow">JOIN CLICKCLICKBUY</p><h1>Create your account</h1>
      <p className="customer-auth-intro">A better everyday shopping experience starts here.</p>
      <div className="customer-auth-socials">
        <button type="button" onClick={() => setNotice("Google sign-up will be enabled when secure authentication is connected.")}><span className="customer-auth-google-mark">G</span>Continue with Google</button>
        <button type="button" onClick={() => setNotice("Facebook sign-up will be enabled when secure authentication is connected.")}><span className="customer-auth-facebook-mark">f</span>Continue with Facebook</button>
      </div>
      <div className="customer-auth-divider"><span>OR CREATE AN ACCOUNT WITH</span></div>
      <div className="customer-auth-methods" role="tablist" aria-label="Registration method">
        <button type="button" role="tab" aria-selected={method === "email"} className={method === "email" ? "is-active" : ""} onClick={() => selectMethod("email")}><Mail size={15}/>Email</button>
        <button type="button" role="tab" aria-selected={method === "phone"} className={method === "phone" ? "is-active" : ""} onClick={() => selectMethod("phone")}><Phone size={15}/>Phone number</button>
      </div>
      {method === "email" ? (
        <form onSubmit={submitEmail} className="customer-auth-form">
          <div className="customer-auth-two-col"><div><label htmlFor="reg-first">First name</label><input id="reg-first" autoComplete="given-name" required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></div><div><label htmlFor="reg-last">Last name</label><input id="reg-last" autoComplete="family-name" required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></div></div>
          <label htmlFor="reg-email">Email address</label><input id="reg-email" type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
          <label htmlFor="reg-phone">Phone number <span>(optional)</span></label><input id="reg-phone" type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>
          <label htmlFor="reg-password">Password</label><input id="reg-password" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">Create Account</button>
        </form>
      ) : (
        <form onSubmit={otpRequested ? verifyPhoneCode : requestPhoneCode} className="customer-auth-form">
          {!otpRequested ? <>
            <div className="customer-auth-two-col"><div><label htmlFor="phone-first">First name</label><input id="phone-first" autoComplete="given-name" required value={form.firstName} onChange={e=>setForm({...form,firstName:e.target.value})}/></div><div><label htmlFor="phone-last">Last name</label><input id="phone-last" autoComplete="family-name" required value={form.lastName} onChange={e=>setForm({...form,lastName:e.target.value})}/></div></div>
            <label htmlFor="reg-phone-otp">Mobile phone number</label><div className="customer-auth-input"><Phone size={18}/><input id="reg-phone-otp" type="tel" inputMode="tel" autoComplete="tel" required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+234 801 234 5678"/></div>
          </> : <>
            <button type="button" className="customer-auth-back" onClick={() => {setOtpRequested(false);setOtp("");setError("");}}>Change details</button>
            <p className="customer-auth-otp-copy">Enter the 6-digit code for <strong>{form.phone}</strong>.</p>
            <label htmlFor="register-otp">Verification code</label><input id="register-otp" className="customer-auth-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000"/>
          </>}
          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">{otpRequested ? "Verify and Create Account" : "Continue with Phone"}</button>
        </form>
      )}
      {notice && <p className="customer-auth-info" role="status">{notice}</p>}
      <div className="customer-demo-notice"><strong>Frontend prototype</strong><span>No real account is created, no SMS is sent and no social provider is contacted. Phone verification is a UI preview; any 6-digit code completes this demo flow. Secure provider integration comes later.</span></div>
      <p className="customer-auth-footnote">Already have a ClickClickBuy account? <Link href="/login">Sign in</Link></p>
    </section></div>
  );
}
