export type ErrorCode =
  | "config-not-found"
  | "config-invalid"
  | "journey-invalid"
  | "dev-server"
  | "browser"
  | "engine-unavailable"
  | "nothing-to-scan";

export interface AltshiftError {
  code: ErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AltshiftError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(code: ErrorCode, message: string): { ok: false; error: AltshiftError } {
  return { ok: false, error: { code, message } };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
