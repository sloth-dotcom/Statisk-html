type Level = "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

function emit(level: Level, event: string, context: LogContext = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Structured JSON logging (SPEC §8). Every pipeline log carries its run id, so a
 * failed run can be reconstructed from the log alone.
 */
export const log = {
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};

export function errorToJson(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return { message: String(error) };
}
