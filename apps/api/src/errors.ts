import type { ApiErrorCode } from '@turnproof/domain';

/**
 * Every failure leaves the API as this shape, so the UI can branch on a stable
 * code instead of parsing prose.
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly detail?: string;

  constructor(statusCode: number, code: ApiErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (message: string, detail?: string): ApiError =>
  new ApiError(400, 'validation_error', message, detail);

export const notFound = (message: string): ApiError => new ApiError(404, 'not_found', message);

export const revisionConflict = (message: string, detail?: string): ApiError =>
  new ApiError(409, 'revision_conflict', message, detail);

export const idempotencyConflict = (message: string, detail?: string): ApiError =>
  new ApiError(409, 'idempotency_conflict', message, detail);

export const payloadTooLarge = (message: string): ApiError =>
  new ApiError(413, 'payload_too_large', message);

export const unsupportedUpdate = (message: string, detail?: string): ApiError =>
  new ApiError(422, 'unsupported_update', message, detail);

export const internalError = (message: string): ApiError =>
  new ApiError(500, 'internal_error', message);
