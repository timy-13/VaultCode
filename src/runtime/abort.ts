export class OperationCancelledError extends Error {
  constructor(message = "Cancelled by user.") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof OperationCancelledError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "AbortError" || error.name === "APIUserAbortError") {
    return true;
  }

  if ("code" in error && error.code === "ABORT_ERR") {
    return true;
  }

  return /cancelled|canceled|aborted/i.test(error.message);
}

export function getAbortMessage(error: unknown, fallback = "Cancelled by user."): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function toAbortError(signal: AbortSignal, fallback = "Cancelled by user."): OperationCancelledError {
  const reason = signal.reason;
  if (reason instanceof OperationCancelledError) {
    return reason;
  }

  if (reason instanceof Error) {
    return new OperationCancelledError(reason.message || fallback);
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return new OperationCancelledError(reason);
  }

  return new OperationCancelledError(fallback);
}
