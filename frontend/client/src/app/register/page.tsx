"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShoppingBag } from "lucide-react";
import { z } from "zod";
import { registerDemoCustomer } from "@/lib/demo-account";

const registrationSchema = z.object({
  firstName: z.string().trim().min(2, "Enter your first name (at least 2 characters).").max(50, "First name must be 50 characters or fewer.").regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u, "Use letters, spaces, apostrophes or hyphens only."),
  lastName: z.string().trim().min(2, "Enter your last name (at least 2 characters).").max(50, "Last name must be 50 characters or fewer.").regex(/^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u, "Use letters, spaces, apostrophes or hyphens only."),
  email: z.string().trim().email("Enter a valid email address.").max(254, "Email address is too long."),
  phone: z.string().trim().refine((value) => value === "" || /^[+\d][\d\s().-]{6,19}$/.test(value), "Enter a valid phone number, including your country code."),
  password: z.string().min(12, "Use at least 12 characters for your password.").max(128, "Password must be 128 characters or fewer."),
  confirmPassword: z.string().min(1, "Please confirm your password."),
  acceptPolicies: z.literal(true, { error: "You must accept the Terms & Conditions and Privacy Policy to create an account." }),
}).superRefine((values, context) => {
  if (values.password !== values.confirmPassword) {
    context.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "The passwords do not match. Check both fields and try again.",
    });
  }
});

type RegistrationValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

type RegistrationField = keyof RegistrationValues | "acceptPolicies";
type RegistrationErrors = Partial<Record<RegistrationField, string>>;

const initialForm: RegistrationValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  function validateField(field: RegistrationField) {
    const result = registrationSchema.safeParse({ ...form, acceptPolicies });
    const issue = result.success ? undefined : result.error.issues.find((item) => item.path[0] === field);
    setErrors((current) => ({ ...current, [field]: issue?.message }));
  }

  function updateField(field: keyof RegistrationValues, value: string) {
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    setNotice("");

    if (submitted) {
      const result = registrationSchema.safeParse({ ...nextForm, acceptPolicies });
      const relevantIssues = result.success
        ? []
        : result.error.issues.filter((issue) =>
            issue.path[0] === field ||
            (field === "password" && issue.path[0] === "confirmPassword"),
          );
      setErrors((current) => ({
        ...current,
        [field]: relevantIssues.find((issue) => issue.path[0] === field)?.message,
        ...(field === "password"
          ? { confirmPassword: relevantIssues.find((issue) => issue.path[0] === "confirmPassword")?.message }
          : {}),
      }));
    } else {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setNotice("");

    const result = registrationSchema.safeParse({ ...form, acceptPolicies });
    if (!result.success) {
      const nextErrors: RegistrationErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as RegistrationField;
        if (!nextErrors[field]) nextErrors[field] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    setErrors({});

    // This branch still uses the local storefront demo account. The live
    // backend registration endpoint will be connected in the auth integration.
    registerDemoCustomer({
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      email: result.data.email.toLowerCase(),
      phone: result.data.phone,
    });
    router.replace("/account");
  }

  function fieldProps(field: RegistrationField) {
    return {
      "aria-invalid": Boolean(errors[field]),
      "aria-describedby": errors[field] ? `reg-${field}-error` : undefined,
      onBlur: () => {
        if (submitted) validateField(field);
      },
    };
  }

  function fieldError(field: RegistrationField) {
    return errors[field] ? (
      <p className="customer-auth-field-error" id={`reg-${field}-error`} role="alert">
        {errors[field]}
      </p>
    ) : null;
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
            onClick={() => setNotice("Google sign-up is not available yet. Secure Google authentication will be enabled when the provider integration is configured.")}
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
            onClick={() => setNotice("Facebook sign-up is not available yet. Secure Facebook authentication will be enabled when the provider integration is configured.")}
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

        <form onSubmit={submitRegistration} className="customer-auth-form" noValidate>
          <div className="customer-auth-form-fields">
            <div className="customer-auth-field">
              <label htmlFor="reg-first">First name *</label>
              <input id="reg-first" autoComplete="given-name" required maxLength={50}
                value={form.firstName} {...fieldProps("firstName")}
                onChange={(event) => updateField("firstName", event.target.value)} />
              {fieldError("firstName")}
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-last">Last name *</label>
              <input id="reg-last" autoComplete="family-name" required maxLength={50}
                value={form.lastName} {...fieldProps("lastName")}
                onChange={(event) => updateField("lastName", event.target.value)} />
              {fieldError("lastName")}
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-email">Email address *</label>
              <input id="reg-email" type="email" autoComplete="email" required maxLength={254}
                value={form.email} {...fieldProps("email")}
                onChange={(event) => updateField("email", event.target.value)} />
              {fieldError("email")}
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-phone">Phone number <span>(optional)</span></label>
              <input id="reg-phone" type="tel" inputMode="tel" autoComplete="tel"
                value={form.phone} {...fieldProps("phone")} placeholder="+234 801 234 5678" />
              <p className="customer-auth-password-hint">
                Optional. Useful for account and delivery updates.
              </p>
              {fieldError("phone")}
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-password">Password *</label>
              <div className="customer-auth-password-control">
                <input id="reg-password" type={showPassword ? "text" : "password"}
                  autoComplete="new-password" required minLength={12} maxLength={128}
                  value={form.password} {...fieldProps("password")}
                  onChange={(event) => updateField("password", event.target.value)} />
                <button type="button" className="customer-auth-password-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}>
                  {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
              <p className="customer-auth-password-hint">
                Use 12–128 characters. A longer, unique passphrase is recommended.
              </p>
              {fieldError("password")}
            </div>

            <div className="customer-auth-field">
              <label htmlFor="reg-confirm-password">Confirm password *</label>
              <div className="customer-auth-password-control">
                <input id="reg-confirm-password" type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password" required maxLength={128}
                  value={form.confirmPassword} {...fieldProps("confirmPassword")}
                  onChange={(event) => updateField("confirmPassword", event.target.value)} />
                <button type="button" className="customer-auth-password-toggle"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}>
                  {showConfirmPassword ? <EyeOff size={21} /> : <Eye size={21} />}
                </button>
              </div>
              {fieldError("confirmPassword")}
            </div>
          </div>

          <div className="customer-auth-policy">
            <input id="reg-accept-policies" type="checkbox" name="acceptPolicies" required
              checked={acceptPolicies} aria-invalid={Boolean(errors.acceptPolicies)}
              aria-describedby={errors.acceptPolicies ? "reg-acceptPolicies-error" : undefined}
              onChange={(event) => {
                const checked = event.target.checked;
                setAcceptPolicies(checked);
                setErrors((current) => ({
                  ...current,
                  acceptPolicies: checked || !submitted
                    ? undefined
                    : "You must accept the Terms & Conditions and Privacy Policy to create an account.",
                }));
              }} />
            <div className="customer-auth-policy-copy">
              <label htmlFor="reg-accept-policies">
                I have read and agree to the{" "}
                <Link href="/terms-and-conditions" target="_blank">Terms &amp; Conditions</Link>
                {" "}and{" "}
                <Link href="/privacy-policy" target="_blank">Privacy Policy</Link>.
              </label>
              {fieldError("acceptPolicies")}
            </div>
          </div>

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
