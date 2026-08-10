/**
 * components/ErrorBoundary.tsx
 * Error boundaries must be class components — there's no hook equivalent
 * (React requires getDerivedStateFromError/componentDidCatch, neither of
 * which exists as a hook as of the version in use here).
 *
 * Two boundaries are used in this app:
 *   - A top-level one around the whole app (main.tsx) — catches anything
 *     that slips through, shows a full-screen friendly fallback.
 *   - A narrower one around AdminPanel only (PlatformApp.tsx) — so an
 *     admin-panel-specific crash doesn't take down the app for a regular
 *     user who never even opens that panel.
 */

import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Rendered instead of the default full-screen fallback — used for the narrower AdminPanel boundary. */
  fallback?: ReactNode;
  /** Short label included in the error report so it's obvious which boundary caught it (e.g. "admin-panel"). */
  boundaryName?: string;
  /** Self-reported only, for triage context — never treated as an authenticated claim server-side. */
  userId?: number;
}
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log locally — this is the non-negotiable minimum.
    console.error(`[ErrorBoundary${this.props.boundaryName ? `:${this.props.boundaryName}` : ""}]`, error, info.componentStack);

    // Best-effort, fire-and-forget report so this shows up somewhere an
    // admin can actually see it. Never lets a failed report affect the
    // fallback UI — this endpoint doesn't require auth, since the app may
    // be in a broken state when this fires.
    try {
      fetch(`${(import.meta as any).env?.VITE_API_URL || "/api"}/client-errors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          boundary: this.props.boundaryName || null,
          url: window.location.href,
          userId: this.props.userId ?? null,
        }),
      }).catch(() => {});
    } catch { /* never let logging itself throw */ }
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: 24,
        textAlign: "center", background: "var(--bg, #0a0a0f)", color: "var(--text, #fff)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ fontSize: 14, color: "var(--text3, #999)", marginBottom: 20, maxWidth: 360 }}>
          We hit an unexpected error. Your account and balances are safe — reloading should fix this.
        </p>
        <button
          onClick={this.handleReload}
          style={{
            padding: "10px 24px", borderRadius: 10, border: "none",
            background: "var(--indigo, #6366f1)", color: "#fff",
            fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
