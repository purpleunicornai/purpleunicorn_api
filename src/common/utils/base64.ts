// Base64 helpers for secrets kept in env vars, e.g. a service-account JSON
// key in VERTEX_SERVICE_ACCOUNT. Decoding mirrors yuv-api's firebase.config.ts:
// JSON.parse(Buffer.from(value, 'base64').toString('ascii')).

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

// Decodes as ASCII, as yuv-api does, which suits JSON keys (service-account
// keys are ASCII). Buffer.from silently skips bad characters, so the input is
// checked first.
export function decodeBase64(base64: string): string {
  const value = base64.replace(/\s+/g, '');
  if (!value || value.length % 4 === 1 || !BASE64.test(value)) {
    throw new Error('Value is not valid base64');
  }
  return Buffer.from(value, 'base64').toString('ascii');
}

export function encodeBase64Json(value: unknown): string {
  return encodeBase64(JSON.stringify(value));
}

export function decodeBase64Json<T = unknown>(base64: string): T {
  const json = decodeBase64(base64);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error('Value is base64 but does not decode to JSON');
  }
}
