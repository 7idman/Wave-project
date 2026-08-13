/**
 * components/Turnstile.tsx
 * Thin wrapper around Cloudflare's Turnstile script. The frontend receives a
 * token, then the backend verifies it with Cloudflare before trusting it.
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

export function Turnstile({ onVerify, onError, onLoad }: { onVerify: (token: string) => void; onError?: () => void; onLoad?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) { setLoadFailed(true); return; }

    // If the widget hasn't rendered within 10s — slow network, a blocked
    // challenges.cloudflare.com request, or the container not being in the
    // DOM yet when the script resolved — stop spinning forever and give the
    // user something actionable instead of a silent, permanent skeleton.
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setTimedOut(true);
    }, 10000);

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onVerify(token),
          "error-callback": () => onError?.(),
          "expired-callback": () => onError?.(),
        });
        window.clearTimeout(timeoutId);
        setReady(true);
        onLoad?.();
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadFailed) {
    return <div className="turnstile-frame" style={{fontSize:12,color:"var(--red)"}}>Verification widget failed to load - please refresh the page.</div>;
  }

  if (timedOut && !ready) {
    return <div className="turnstile-frame" style={{fontSize:12,color:"var(--red)"}}>This is taking longer than expected — please refresh the page and try again.</div>;
  }

  return (
    <div className="turnstile-frame">
      {!ready&&<div className="turnstile-skeleton"><span className="btn-spinner"/> Loading verification...</div>}
      <div ref={containerRef} style={{minHeight:65,visibility:ready?"visible":"hidden"}}/>
    </div>
  );
}
