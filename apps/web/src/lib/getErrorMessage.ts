type AxiosLike = {
  response?: { data?: unknown };
  message?: string;
};

function extractString(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) return val.trim();
  if (Array.isArray(val)) {
    const parts = val.map((v) => extractString(v)).filter(Boolean) as string[];
    return parts.length ? parts.join('\n') : null;
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    // NestJS nested: { message: { message, error, statusCode } }
    if (obj['message'] !== undefined) return extractString(obj['message']);
    if (obj['error'] !== undefined && typeof obj['error'] === 'string') return obj['error'];
  }
  return null;
}

export function getErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';

  // Axios error — check response.data first
  const axiosErr = error as AxiosLike;
  if (axiosErr?.response?.data !== undefined) {
    const fromData = extractString(axiosErr.response.data);
    if (fromData) return fromData;
  }

  // Plain Error or any object with .message
  if (error instanceof Error) return error.message || 'An unexpected error occurred.';

  const fromVal = extractString(error);
  if (fromVal) return fromVal;

  return 'An unexpected error occurred.';
}
