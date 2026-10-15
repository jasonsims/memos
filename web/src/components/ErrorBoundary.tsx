import { AlertCircle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { toPendoText, trackPendoEvent } from "@/lib/pendo";
import { isChunkLoadError } from "@/utils/lazy";
import { Button } from "./ui/button";

// Module scope: a fallback that remounts for an error it already reported does not report it again.
const reportedErrors = new WeakSet<object>();

const trackAppError = (errorType: "render" | "route", error: unknown, componentStack?: string | null) =>
  trackPendoEvent("app_error_encountered", () => ({
    error_type: errorType,
    error_name: error instanceof Error ? error.name : typeof error,
    error_message: toPendoText(error instanceof Error ? error.message : undefined),
    is_chunk_load_error: isChunkLoadError(error),
    // The innermost component, e.g. "at MemoView (…)" becomes "MemoView".
    component_stack_top: toPendoText(
      componentStack
        ?.trim()
        .split("\n")[0]
        ?.trim()
        .replace(/^at /, "")
        .split(/[\s@(]/)[0],
      80,
    ),
  }));

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    trackAppError("render", error, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="w-8 h-8" />
              <h1 className="text-2xl font-bold">Something went wrong</h1>
            </div>

            <p className="text-foreground/70">
              An unexpected error occurred. This could be due to a network issue or a problem with the application.
            </p>

            {this.state.error && (
              <details className="bg-muted p-3 rounded-md text-sm">
                <summary className="cursor-pointer font-medium mb-2">Error details</summary>
                <pre className="whitespace-pre-wrap break-words text-xs text-foreground/60">{this.state.error.message}</pre>
              </details>
            )}

            <Button onClick={this.handleReset} className="w-full gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload Application
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// React Router errorElement for route-level errors (e.g., failed chunk loads after redeployment).
export function ChunkLoadErrorFallback() {
  const error = useRouteError() as Error | undefined;

  useEffect(() => {
    if (typeof error === "object" && error !== null) {
      if (reportedErrors.has(error)) return;
      reportedErrors.add(error);
    }
    trackAppError("route", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="w-8 h-8" />
          <h1 className="text-2xl font-bold">Something went wrong</h1>
        </div>

        <p className="text-foreground/70">
          An unexpected error occurred. This could be due to a network issue or an application update. Reloading usually fixes it.
        </p>

        {error?.message && (
          <details className="bg-muted p-3 rounded-md text-sm">
            <summary className="cursor-pointer font-medium mb-2">Error details</summary>
            <pre className="whitespace-pre-wrap break-words text-xs text-foreground/60">{error.message}</pre>
          </details>
        )}

        <Button onClick={() => window.location.reload()} className="w-full gap-2">
          <RefreshCw className="w-4 h-4" />
          Reload Application
        </Button>
      </div>
    </div>
  );
}
