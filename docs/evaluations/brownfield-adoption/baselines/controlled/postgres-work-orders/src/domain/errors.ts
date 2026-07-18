export type PublicErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_REQUEST'
  | 'ROUTE_NOT_FOUND'
  | 'WORK_ORDER_NOT_FOUND'
  | 'WORK_ORDER_EXISTS'
  | 'ALREADY_CLOSED'
  | 'INVALID_STATUS'
  | 'INSPECTION_REQUIRED'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: PublicErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
