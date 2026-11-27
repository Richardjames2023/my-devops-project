"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiRequest, setAuthTokens } from "@/lib/api/client";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          prompt: () => void;
        };
      };
    };
    FB?: {
      init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (callback: (response: { authResponse?: { accessToken: string }; status?: string }) => void, options: { scope: string }) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type SocialSession = { accessToken: string; refreshToken: string };

export default function SocialAuthButtons() {
  const router = useRouter();
  const [googleReady, setGoogleReady] = useState(false);
  const [facebookReady, setFacebookReady] = useState(false);
  const [busy, setBusy] = useState<"google" | "facebook" | null>(null);
  const [error, setError] = useState("");
  const googleInitialized = useRef(false);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const facebookAppId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;

  useEffect(() => {
    if (googleClientId) {
      const ready = () => {
        if (!window.google || googleInitialized.current) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            setBusy("google");
            setError("");
            try {
              const result = await apiRequest<SocialSession>("/auth/google", { method: "POST", body: { credential } });
              setAuthTokens(result);
              router.replace("/account");
            } catch (cause) {
              setError(cause instanceof ApiError ? cause.message : "Google sign-in could not be completed.");
              setBusy(null);
            }
          },
        });
        googleInitialized.current = true;
        setGoogleReady(true);
      };
      if (window.google) ready();
      else {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = ready;
        script.onerror = () => setError("Google sign-in could not be loaded.");
        document.head.appendChild(script);
      }
    }

    if (facebookAppId) {
      window.fbAsyncInit = () => {
        window.FB?.init({ appId: facebookAppId, cookie: true, xfbml: false, version: "v27.0" });
        setFacebookReady(Boolean(window.FB));
      };
      if (window.FB) {
        window.FB.init({ appId: facebookAppId, cookie: true, xfbml: false, version: "v27.0" });
        setFacebookReady(true);
      } else if (!document.querySelector('script[data-clickclickbuy-facebook="true"]')) {
        const script = document.createElement("script");
        script.dataset.clickclickbuyFacebook = "true";
        script.src = "https://connect.facebook.net/en_US/sdk.js";
        script.async = true;
        script.defer = true;
        script.crossOrigin = "anonymous";
        document.body.appendChild(script);
      }
    }
  }, [facebookAppId, googleClientId, router]);

  function signInWithGoogle() {
    setError("");
    if (!googleReady || !window.google) {
      setError("Google sign-in is not configured. Please try again later.");
      return;
    }
    window.google.accounts.id.prompt();
  }

  function signInWithFacebook() {
    setError("");
    if (!facebookReady || !window.FB) {
      setError("Facebook sign-in is not configured. Please try again later.");
      return;
    }
    setBusy("facebook");
    window.FB.login(async (response) => {
      const token = response.authResponse?.accessToken;
      if (!token) {
        setBusy(null);
        setError("Facebook sign-in was cancelled or did not return permission.");
        return;
      }
      try {
        const result = await apiRequest<SocialSession>("/auth/facebook", { method: "POST", body: { accessToken: token } });
        setAuthTokens(result);
        router.replace("/account");
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Facebook sign-in could not be completed.");
        setBusy(null);
      }
    }, { scope: "email" });
  }

  return (
    <>
      <div className="customer-auth-socials">
        <button type="button" onClick={signInWithGoogle} disabled={busy !== null} aria-label="Continue with Google">
          <span className="customer-auth-google-mark">G</span>{busy === "google" ? "Connecting..." : "Continue with Google"}
        </button>
        <button type="button" onClick={signInWithFacebook} disabled={busy !== null} aria-label="Continue with Facebook">
          <span className="customer-auth-facebook-mark">f</span>{busy === "facebook" ? "Connecting..." : "Continue with Facebook"}
        </button>
      </div>
      {error && <p className="customer-auth-error" role="alert">{error}</p>}
    </>
  );
}
