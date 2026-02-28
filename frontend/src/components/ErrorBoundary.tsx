import React, { Component, type ErrorInfo, type ReactNode } from "react";

// ─── FE-H-02 Remediation ────────────────────────────────────────────────────
// Root-level + scoped error boundaries to prevent full white-screen on throw.
// See: https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI — if omitted, the default crash screen is shown */
  fallback?: ReactNode;
  /** Scope label shown in the error UI so users know which section failed */
  scope?: string;
  /** Called when an error is caught — wire to your analytics / Sentry / logging */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React error boundary.
 *
 * Usage:
 *   <ErrorBoundary scope="Wallet">
 *     <WalletConnector />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return <DefaultErrorFallback scope={this.props.scope} error={this.state.error} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

// ─── Scoped boundaries for critical flows ────────────────────────────────────

/** Wraps wallet connection UI — wallets throw frequently on disconnect/network switch */
export function WalletErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      scope="Wallet"
      fallback={
        <div className="rounded-xl border border-red-500/20 bg-red-950/30 p-6 text-center">
          <p className="text-red-400 font-medium">Wallet connection error</p>
          <p className="mt-1 text-sm text-gray-400">Please refresh the page and reconnect your wallet.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-500"
          >
            Reload Page
          </button>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Wraps transaction flows — prevents a failed tx render from crashing the whole page */
export function TransactionErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary scope="Transaction">
      {children}
    </ErrorBoundary>
  );
}

/** Wraps data-fetching sections (dashboards, tables, charts) */
export function DataErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary scope="Data">
      {children}
    </ErrorBoundary>
  );
}

// ─── Default fallback UI ─────────────────────────────────────────────────────

function DefaultErrorFallback({
  scope,
  error,
  onRetry,
}: {
  scope?: string;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-950/20 p-8">
      <div className="mb-4 text-4xl">⚠️</div>
      <h2 className="text-lg font-semibold text-red-400">
        {scope ? `${scope} Error` : "Something went wrong"}
      </h2>
      <p className="mt-2 max-w-md text-center text-sm text-gray-400">
        {error?.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={onRetry}
          className="rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          Try Again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          Reload Page
        </button>
      </div>
    </div>
  );
}
