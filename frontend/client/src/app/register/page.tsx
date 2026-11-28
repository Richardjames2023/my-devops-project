"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
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
            <svg className="customer-auth-provider-icon" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.91c-.58 2.96-2.25 5.48-4.73 7.18l7.65 5.94c4.47-4.13 7.15-10.21 7.15-17.59Z"/>
              <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.86l-7.65-5.94c-2.13 1.45-4.86 2.3-8.25 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
            </svg>
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => setNotice("Facebook sign-up will be available when secure Facebook authentication is connected.")}
          >
            <svg className="customer-auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.86v-8.39H7.08V12h3.045V9.35c0-3.005 1.79-4.665 4.53-4.665 1.312 0 2.685.234 2.685.234v2.95h-1.513c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.47h-2.796v8.39A12.002 12.002 0 0 0 24 12Z"/>
            </svg>
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

          <label className="customer-auth-policy">
            <input type="checkbox" name="acceptPolicies" required />
            <span>
              I have read and agree to the <Link href="/terms-and-conditions" target="_blank">Terms &amp; Conditions</Link> and <Link href="/privacy-policy" target="_blank">Privacy Policy</Link>.
            </span>
          </label>
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
  );
}
