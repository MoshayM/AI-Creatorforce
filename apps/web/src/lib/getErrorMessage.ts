type AxiosLike = {
  response?: { data?: unknown };
  message?: string;
};

/**
 * Friendly guidance per error-envelope `code` (Updates/32), appended to the
 * server message for categories where the raw text is technical and the fix
 * is on the user's side of the screen (risk R-06: provider outages read as
 * generic failures).
 */
const CODE_HINTS: Record<string, string> = {
  PROVIDER:
    'This is usually a temporary provider outage — nothing was charged. Try again in a moment.',
  RATE_LIMITED: "You're sending requests too quickly — wait a few seconds and try again.",
};

function envelopeHint(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const code = (data as Record<string, unknown>)['code'];
  return typeof code === 'string' ? (CODE_HINTS[code] ?? null) : null;
}

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
    const hint = envelopeHint(axiosErr.response.data);
    if (fromData && hint) return `${fromData.replace(/\.?\s*$/, '.')} ${hint}`;
    if (fromData) return fromData;
    if (hint) return hint;
  }

  // Plain Error or any object with .message
  if (error instanceof Error) return error.message || 'An unexpected error occurred.';

  const fromVal = extractString(error);
  if (fromVal) return fromVal;

  return 'An unexpected error occurred.';
}
