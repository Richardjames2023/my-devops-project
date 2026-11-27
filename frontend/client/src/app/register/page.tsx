"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShoppingBag } from "lucide-react";
import { registerDemoCustomer } from "@/lib/demo-account";

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
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
      <div className="customer-auth-layout">
        <aside className="customer-auth-visual" aria-label="ClickClickBuy shopping experience">
          <div className="customer-auth-visual-copy">
            <span>GOOD FINDS. GREAT EVERYDAY.</span>
            <h2>More of what you love, all in one place.</h2>
            <p>Discover useful finds for your home, style and everyday routines with ClickClickBuy.</p>
          </div>
          <div className="customer-auth-visual-art">
            <Image
              src="/images/registration-shopping-illustration.png"
              alt="A shopper enjoying ClickClickBuy finds, with fashion, home and lifestyle products"
              fill
              priority
              sizes="(min-width: 1100px) 42vw, 100vw"
            />
          </div>
          <div className="customer-auth-visual-trust">
            <span>Delivery across Nigeria</span>
            <span>Secure shopping experience</span>
          </div>
        </aside>
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

        <div className="customer-auth-socials">
          <button
            type="button"
            onClick={() => setNotice("Google sign-up will be available when secure Google authentication is connected.")}
          >
            <span className="customer-auth-google-mark">G</span>
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => setNotice("Facebook sign-up will be available when secure Facebook authentication is connected.")}
          >
            <span className="customer-auth-facebook-mark">f</span>
            Continue with Facebook
          </button>
        </div>

        <div className="customer-auth-divider">
          <span>OR SIGN UP WITH EMAIL</span>
        </div>

        <form onSubmit={submitRegistration} className="customer-auth-form">
          <div className="customer-auth-form-fields">
            <div className="customer-auth-field">
              <label htmlFor="reg-first">First name *</label>
              <input
                id="reg-first"
                autoComplete="given-name"
                required
                value={form.firstName}
                onChange={(event) => updateField("firstName", event.target.value)}
              />
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-last">Last name *</label>
              <input
                id="reg-last"
                autoComplete="family-name"
                required
                value={form.lastName}
                onChange={(event) => updateField("lastName", event.target.value)}
              />
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-email">Email address *</label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
            </div>

            <div className="customer-auth-field">
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
                Optional. Useful for account and delivery updates.
              </p>
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-password">Password *</label>
              <div className="customer-auth-password-control">
                <input
                  id="reg-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={form.password}
                  onChange={(event) => updateField("password", event.target.value)}
                />
                <button
                  type="button"
                  className="customer-auth-password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
              <p className="customer-auth-password-hint">
                Use 12–128 characters. A longer, unique passphrase is recommended.
              </p>
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-confirm-password">Confirm password *</label>
              <div className="customer-auth-password-control">
                <input
                  id="reg-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={form.confirmPassword}
                  onChange={(event) => updateField("confirmPassword", event.target.value)}
                />
                <button
                  type="button"
                  className="customer-auth-password-toggle"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}
                >
                  {showConfirmPassword ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
            </div>
          </div>

          {error && <p className="customer-auth-error" role="alert">{error}</p>}
          <button className="customer-auth-submit" type="submit">
            Create Account
          </button>
        </form>

        {notice && <p className="customer-auth-info" role="status">{notice}</p>}

        <p className="customer-auth-footnote">
          Already have a ClickClickBuy account? <Link href="/login">Sign in</Link>
        </p>
        </section>
      </div>
    </div>
  );
}
