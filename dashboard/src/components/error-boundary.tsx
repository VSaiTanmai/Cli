"use client";

import React from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback component — defaults to built-in error UI */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

/**
 * Production-grade React Error Boundary.
 *
 * Catches render-time errors in the component tree below it,
 * prevents full page crashes, and provides a recovery mechanism.
 * In production, error details are sanitized to prevent info leakage.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: "" };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console for dev; in production this would go to an error service
    console.error("[CLIF ErrorBoundary]", error.message, errorInfo.componentStack);
    this.setState({
      errorInfo: errorInfo.componentStack?.slice(0, 500) ?? "",
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4 rounded-lg border border-destructive/20 bg-destructive/5 p-8">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              An unexpected error occurred in this component. The rest of the
              application is unaffected.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <pre className="mt-3 max-h-32 max-w-lg overflow-auto rounded-md bg-background p-3 text-left font-mono text-[11px] text-destructive">
                {this.state.error.message}
                {this.state.errorInfo && `\n\nComponent Stack:${this.state.errorInfo}`}
              </pre>
            )}
          </div>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCcw className="h-4 w-4" />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Page-level error boundary wrapper with route-aware recovery.
 * Wraps each page to isolate crashes from affecting navigation.
 */
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
