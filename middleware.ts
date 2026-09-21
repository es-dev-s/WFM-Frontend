import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "@/lib/auth/session-token";

const COOKIE = process.env.AUTH_COOKIE_NAME?.trim() || "wfm_session";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/api/v1/auth/login") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(COOKIE)?.value ?? "";
  const secret = process.env.SESSION_SECRET?.trim() || "";
  const valid = Boolean(token && secret && (await verifySessionToken(token, secret)));

  if (pathname.startsWith("/api/")) {
    if (valid) return NextResponse.next();
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to continue.", code: 401 },
      { status: 401 },
    );
  }

  if (valid) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
