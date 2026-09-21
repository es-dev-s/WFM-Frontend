import { AUTH_COOKIE } from "@/lib/server/auth/types";
import { BffError } from "@/lib/server/upstream";

export { AUTH_COOKIE };

function cookieSecure(request?: Request): boolean {
  const flag = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  if (!request) return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function cookieFlags(request?: Request): string {
  const secure = cookieSecure(request) ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function cookieHeader(token: string, maxAge: number, request?: Request): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(request)}; Max-Age=${maxAge}`;
}

export function expireCookieHeader(request?: Request): string {
  return `${AUTH_COOKIE}=; ${cookieFlags(request)}; Max-Age=0`;
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
