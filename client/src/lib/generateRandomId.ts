// Random ID for client-side React keys (dialogs, image previews) and filename
// generation. 12 bytes (96 bits of entropy) is a multiple of 3 so the base64
// output is exactly 16 chars with no `=` padding. Translated to base64url
// (`+` → `-`, `/` → `_`) so the result is safe in URLs and Windows filenames.
// `crypto.getRandomValues` works in any context (unlike `crypto.randomUUID`,
// which requires a secure context).
export function generateRandomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
