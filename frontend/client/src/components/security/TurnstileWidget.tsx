"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileWidgetHandle = string;

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        action: string;
        theme?: "light" | "dark" | "auto";
        callback: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
      }) => TurnstileWidgetHandle;
      reset: (widgetId?: TurnstileWidgetHandle) => void;
      remove: (widgetId: TurnstileWidgetHandle) => void;
    };
  }
}

type TurnstileWidgetProps = {
  siteKey: string;
  resetKey: number;
  onVerify: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
};

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onVerify,
  onExpire,
  onError,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<TurnstileWidgetHandle | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!siteKey) return;
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const handleLoad = () => setScriptReady(true);
    const handleError = () => {
      setLoadFailed(true);
      onError();
    };

    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
      document.head.appendChild(script);
    } else {
      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });
    }

    return () => {
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };
  }, [siteKey, onError]);

  useEffect(() => {
    if (!scriptReady || !window.turnstile || !containerRef.current || widgetIdRef.current) return;

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: "customer_registration",
      theme: "auto",
      callback: onVerify,
      "expired-callback": onExpire,
      "error-callback": onError,
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [scriptReady, siteKey, onVerify, onExpire, onError]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetKey]);

  if (!siteKey) {
    return <p className="customer-auth-security-error" role="alert">Security verification is not configured. Please try again later.</p>;
  }

  return (
    <div className="customer-auth-turnstile">
      <div ref={containerRef} />
      {loadFailed && <p className="customer-auth-security-error" role="alert">The security check could not load. Refresh the page and try again.</p>}
    </div>
  );
}
