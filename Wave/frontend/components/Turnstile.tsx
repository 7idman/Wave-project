/**
 * components/Turnstile.tsx
 * Thin wrapper around Cloudflare's Turnstile script. Renders a widget,
 * calls onVerify(token) when the visitor passes the challenge. The token
 * itself proves nothing on its own — the backend re-verifies it against
 * Cloudflare on every submit. VITE_TURNSTILE_SITE_KEY is the PUBLIC site
 * key; the secret key lives only in the backend's env vars, never here.
 */

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; "expired-callback"?: () => void; theme?: string }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    __turnstileScriptLoading?: Promise<void>;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileScriptLoading) return window.__turnstileScriptLoading;
  window.__turnstileScriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile"));
    document.head.appendChild(script);
  });
  return window.__turnstileScriptLoading;
}

export function Turnstile({ onVerify, onError }: { onVerify: (token: string) => void; onError?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef   = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) { setLoadFailed(true); return; }

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onVerify(token),
          "error-callback": () => onError?.(),
          "expired-callback": () => onError?.(),
        });
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadFailed) return <div style={{fontSize:12,color:"var(--red)"}}>Verification widget failed to load — please refresh the page.</div>;
  return <div ref={containerRef} style={{marginBottom:16}}/>;
}
