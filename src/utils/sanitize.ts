/**
 * Sensitive data sanitization
 */

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /sk-[A-Za-z0-9]{32,}/gi,
  /api[_-]?key["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
  /Authorization["\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
];

export function sanitize(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
