import { AUTH_COOKIE } from "@/lib/server/auth/types";
import { BffError } from "@/lib/server/upstream";

export { AUTH_COOKIE };

export function cookieHeader(token: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function expireCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(header: string | null, name = AUTH_COOKIE): string {
  if (!header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("=").trim());
      } catch {
        return rest.join("=").trim();
      }
    }
  }
  return "";
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new BffError(403, "forbidden", "Cross-origin request blocked.");
  }
  const requestHost = request.headers.get("host") || new URL(request.url).host;
  if (originHost !== requestHost) {
    throw new BffError(403, "forbidden", "Cross-origin request blocked.");
  }
}
