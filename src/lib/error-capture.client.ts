import { recordErrorLog } from "@/lib/error-logging.functions";

export interface ErrorLogContext {
  user_id?: string;
  route?: string;
  [key: string]: unknown;
}

let globalContext: ErrorLogContext = {};

export function setErrorLogContext(context: ErrorLogContext) {
  globalContext = { ...globalContext, ...context };
}

export function clearErrorLogContext() {
  globalContext = {};
}

/**
 * Capture and log errors from anywhere in the app
 */
export async function captureError(args: {
  error: Error | unknown;
  category: string;
  level?: "error" | "warning" | "info";
  context?: Record<string, unknown>;
  file?: string;
  line?: number;
}) {
  const error =
    args.error instanceof Error
      ? args.error
      : new Error(String(args.error ?? "Unknown error"));

  const stack = error.stack ?? "";
  const fileMatch = stack.match(/at\s+(?:\w+\s+)*\(([^)]+):(\d+):\d+\)/);
  const file = args.file ?? fileMatch?.[1];
  const line = args.line ?? (fileMatch ? parseInt(fileMatch[2], 10) : undefined);

  try {
    await recordErrorLog({
      level: args.level ?? "error",
      category: args.category,
      message: error.message,
      file,
      line,
      stack,
      context: { ...globalContext, ...args.context },
    });
  } catch (logError) {
    console.error("Failed to capture error log", logError);
  }

  // Also log to console for development
  if (process.env.NODE_ENV === "development") {
    console.error(
      `[${args.category}]`,
      error.message,
      args.context ?? {},
      error
    );
  }
}

/**
 * Global error boundary hook for React
 */
export function useErrorHandler() {
  return {
    handle: (error: Error | unknown, category: string) => {
      captureError({
        error,
        category,
        level: "error",
        context: { source: "useErrorHandler" },
      });
    },
  };
}

/** Setup global error handlers */
export function setupGlobalErrorHandling() {
  // Catch unhandled promise rejections
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
      captureError({
        error: event.reason,
        category: "unhandledRejection",
        level: "error",
        context: { source: "window.unhandledrejection" },
      });
    });

    // Catch uncaught errors
    window.addEventListener("error", (event) => {
      captureError({
        error: event.error || event.message,
        category: "uncaughtError",
        level: "error",
        file: event.filename,
        line: event.lineno,
        context: { source: "window.error", colno: event.colno },
      });
    });
  }
}
