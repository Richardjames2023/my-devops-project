"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { registerDemoCustomer } from "@/lib/demo-account";
import SocialAuthButtons from "@/components/SocialAuthButtons";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");

  function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (form.password.length < 12) {
      setError("Your password must contain at least 12 characters.");
      return;
    }
    if (form.password.length > 128) {
      setError("Your password must contain no more than 128 characters.");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }
    if (form.phone.trim() && form.phone.trim().length < 7) {
      setError("Enter a valid phone number or leave this field empty.");
      return;
    }

    // This branch still uses the local storefront demo account. The live
    // backend registration endpoint will be connected in the auth integration.
    registerDemoCustomer({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
    });
    router.replace("/account");
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="customer-auth-page">
      <section className="customer-auth-card">
        <Link href="/" className="customer-auth-brand">
          <ShoppingBag size={25} />
          <span>ClickClick<strong>Buy</strong></span>
        </Link>
        <p className="customer-auth-eyebrow">JOIN CLICKCLICKBUY</p>
        <h1>Create your account</h1>
        <p className="customer-auth-intro">
          A better everyday shopping experience starts here.
        </p>

        <SocialAuthButtons />
      <div className="customer-auth-divider">
          <span>OR SIGN UP WITH EMAIL</span>
        </div>

        <form onSubmit={submitRegistration} className="customer-auth-form">
          <div className="customer-auth-two-col">
            <div>
              <label htmlFor="reg-first">First name *</label>
              <input
                id="reg-first"
                autoComplete="given-name"
                required
                value={form.firstName}
                onChange={(event) => updateField("firstName", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="reg-last">Last name *</label>
              <input
                id="reg-last"
                autoComplete="family-name"
                required
                value={form.lastName}
                onChange={(event) => updateField("lastName", event.target.value)}
              />
            </div>
          </div>

          <label htmlFor="reg-email">Email address *</label>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
          />

          <label htmlFor="reg-phone">
            Phone number <span>(optional)</span>
          </label>
          <input
            id="reg-phone"
            type="tel"
            autoComplete="tel"
            minLength={7}
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+234 801 234 5678"
          />
          <p className="customer-auth-password-hint">
            Add a phone number to make it easier to manage your account and delivery details.
          </p>

          <label htmlFor="reg-password">Password *</label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={form.password}
            onChange={(event) => updateField("password", event.target.value)}
          />
          <p className="customer-auth-password-hint">
            Use 12–128 characters. A longer, unique passphrase is recommended.
          </p>

          <label htmlFor="reg-confirm-password">Confirm password *</label>
          <input
            id="reg-confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={form.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
          />

          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">
            Create Account
          </button>
        </form>


        <div className="customer-demo-notice">
          <strong>Frontend prototype</strong>
          <span>
            This form currently creates a local demo account only. It does not
            create a backend account or send an email verification message.
            Secure registration and verification will be enabled during API integration.
          </span>
        </div>

        <p className="customer-auth-footnote">
          Already have a ClickClickBuy account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
