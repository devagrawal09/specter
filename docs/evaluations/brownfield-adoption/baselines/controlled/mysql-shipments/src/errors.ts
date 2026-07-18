export type ErrorCode =
  | "BAD_JSON"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "PAYMENT_NOT_CAPTURED"
  | "INVENTORY_NOT_ALLOCATED"
  | "REFERENCE_CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 500,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  console.error(error);
  return new AppError(500, "INTERNAL_ERROR", "An unexpected error occurred");
}
