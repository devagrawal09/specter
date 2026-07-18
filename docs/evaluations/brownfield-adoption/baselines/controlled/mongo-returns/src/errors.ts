import { MongoServerError } from "mongodb";

export type ErrorStatus = 400 | 404 | 409 | 500;

export class AppError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isDuplicateKeyError(error: unknown): error is MongoServerError {
  return error instanceof MongoServerError && error.code === 11000;
}
