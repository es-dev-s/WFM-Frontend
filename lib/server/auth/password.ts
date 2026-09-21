import bcrypt from "bcryptjs";

const ROUNDS = 12;
const MIN_LENGTH = 12;

export function assertPassword(password: string): string {
  const value = password.trim();
  if (value.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new Error("Password must include letters and numbers.");
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(assertPassword(password), ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `Wfm#${body.slice(0, 10)}9`;
}
