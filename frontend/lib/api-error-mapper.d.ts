export function mapApiErrorMessage(
  error?:
    | Error
    | { message?: string; code?: string; status?: number; response?: { status?: number } }
    | string
    | null
): string;
