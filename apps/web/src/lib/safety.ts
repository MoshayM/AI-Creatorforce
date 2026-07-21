/**
 * Client-side safety guardrails.
 * These are a first-pass defence; the server enforces all limits server-side too.
 * Categories: jailbreak | adult | abuse | financial | system_break | spam
 */

export type SafetyCategory =
  | 'jailbreak'
  | 'adult'
  | 'abuse'
  | 'financial'
  | 'system_break'
  | 'spam';

export interface SafetyResult {
  ok: boolean;
  category?: SafetyCategory;
  message: string;
}

// ── Pattern banks ─────────────────────────────────────────────────────────────

/** Attempts to override AI instructions / prompt-injection / jailbreaks */
const JAILBREAK: RegExp[] = [
  /ignore (previous|all|your|prior) instructions/i,
  /you are now (DAN|an?\s+(unrestricted|unfiltered|jailbroken|evil))/i,
  /pretend (you (are|have)|to be) .{0,30}(no restrictions|unethical|harmful|evil)/i,
  /bypass (your|all|safety) (filters?|restrictions?|guidelines?|safety)/i,
  /act as if (you have no|there are no) restrictions/i,
  /forget (your|all) (guidelines?|rules?|instructions?|training|constraints?)/i,
  /\[system\s*(prompt|message|override|admin)\]/i,
  /(developer|jailbreak|god|unrestricted|dan)\s*mode\s*(enabled|on|activated)/i,
  /new (system )?instructions?:/i,
  /override (safety|compliance|content) (filters?|checks?|policies?)/i,
  /respond (only|always) (as|like) .{0,30}(no (filters?|restrictions?|ethics?))/i,
  /you must (always|now) comply with/i,
  /disregard (your|all|previous) (training|guidelines?|ethics?|values?)/i,
];

/** Explicit adult / pornographic content requests */
const ADULT: RegExp[] = [
  /\b(porn(ography)?|xxx|nsfw\s+content|erotic(a|ism)?)\b/i,
  /\bsexually explicit\b/i,
  /\badult (film|content|video|material)\b/i,
  /\b(hentai|onlyfans content|strip(per)? video)\b/i,
  /generate .{0,30}(nude|naked|sex) (image|video|content|scene)/i,
  /script .{0,30}(sexual act|intercourse|masturbat)/i,
];

/** Spam / flooding patterns */
const SPAM: RegExp[] = [
  /(.)\1{30,}/,              // >30 repeated chars in a row
  /^[\s\n\r\t]{0,5}$/,       // empty / whitespace only
];

/**
 * Bulk-generation patterns that could drain credits / abuse infrastructure.
 * NOTE: individual batch requests handled via pending-confirm flow; these catch
 * attempts to slip bulk work through the normal chat path.
 */
const FINANCIAL: RegExp[] = [
  /generate (over |more than )?(1[\s,]?000|[2-9]\d{3}|\d{4,})\s+videos?/i,
  /\b(mass[- ]?produce|mass[- ]?generate|bulk[- ]?creat|bulk[- ]?generat)\b.{0,40}videos?/i,
  /creat.{0,20}(unlimited|infinite)\s+videos?/i,
  /automat.{0,30}(upload|publish|post)\s+without (review|approval|checking)/i,
];

/**
 * Code / injection patterns that could break the application or exfiltrate data.
 * YouTube creators don't need to embed code in chat messages.
 */
const SYSTEM_BREAK: RegExp[] = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/(html|javascript)/i,
  /on(load|error|click|mouseover)\s*=/i,   // HTML event handlers
  /union\s+select|drop\s+table|insert\s+into\s+\w/i,
  /__proto__|constructor\s*\[\s*["']?prototype/i,
  /\beval\s*\(/i,
  /process\.env\b/i,
  /require\s*\(\s*['"`]/i,
  /window\.(location|open)\s*=/i,
  /document\.(write|cookie|domain)\s*=/i,
  /\$\{\s*.*\s*\}\s*`/,   // template-literal injection
  /<!--.*-->/s,            // HTML comments (injection vector)
];

// ── Classifier ────────────────────────────────────────────────────────────────

export function checkInputSafety(input: string): SafetyResult {
  const t = input.trim();

  // Empty / whitespace
  if (SPAM.some(p => p.test(t))) {
    return {
      ok: false,
      category: 'spam',
      message: "That doesn't look like a real message. Try again!",
    };
  }

  // Max length (prevents token-stuffing / cost abuse)
  if (t.length > 4_000) {
    return {
      ok: false,
      category: 'abuse',
      message: 'Message is too long — keep it under 4,000 characters and I can help better.',
    };
  }

  // Jailbreak / prompt injection
  if (JAILBREAK.some(p => p.test(t))) {
    return {
      ok: false,
      category: 'jailbreak',
      message: "That looks like an attempt to override my guidelines. I can't follow that — but I'm still here to help with your content!",
    };
  }

  // Code / system-break injection
  if (SYSTEM_BREAK.some(p => p.test(t))) {
    return {
      ok: false,
      category: 'system_break',
      message: "Your message contains code or patterns I can't process. Keep it plain text and I'll do the rest.",
    };
  }

  // Adult / explicit content
  if (ADULT.some(p => p.test(t))) {
    return {
      ok: false,
      category: 'adult',
      message: "I only help with YouTube content creation — adult content requests aren't something I can assist with.",
    };
  }

  // Financial / bulk abuse
  if (FINANCIAL.some(p => p.test(t))) {
    return {
      ok: false,
      category: 'financial',
      message: 'Bulk generation this large needs manual review. Break it into smaller batches or contact support.',
    };
  }

  return { ok: true, message: '' };
}

/** Maps API HTTP error codes to user-facing messages */
export function httpErrorMessage(status: number): string {
  switch (status) {
    case 400: return 'That request was invalid — try rephrasing.';
    case 401: return 'Session expired. Please log in again.';
    case 403: return "You don't have permission to do that.";
    case 429: return "You're sending messages too fast — slow down a bit and try again.";
    case 500:
    case 502:
    case 503: return 'Something went wrong on our end. Try again in a moment.';
    default:  return 'Something went wrong. Try again.';
  }
}

/** Category → colour for the blocked-message UI chip */
export const SAFETY_COLORS: Record<SafetyCategory, { bg: string; border: string; text: string; icon: string }> = {
  jailbreak:    { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', icon: '🚫' },
  adult:        { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', icon: '🔞' },
  abuse:        { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '⚠️' },
  financial:    { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '💳' },
  system_break: { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C', icon: '🛡️' },
  spam:         { bg: '#F9FAFB', border: '#E5E7EB', text: '#6B7280', icon: '❌' },
};
