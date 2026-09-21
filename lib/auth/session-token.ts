const encoder = new TextEncoder();

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToB64(new Uint8Array(signature));
}

export async function signSessionToken(
  sessionId: string,
  expiresAt: number,
  secret: string,
): Promise<string> {
  const payload = `${sessionId}.${expiresAt}`;
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<{ sessionId: string; expiresAt: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expRaw, signature] = parts;
  if (!sessionId || !expRaw || !signature) return null;
  const expiresAt = Number(expRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return null;
  const expected = await hmac(secret, `${sessionId}.${expRaw}`);
  if (expected.length !== signature.length) return null;
  let different = 0;
  for (let i = 0; i < expected.length; i += 1) {
    different |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (different !== 0) return null;
  return { sessionId, expiresAt };
}

export function randomSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes);
}
