import { NextResponse } from "next/server";
import { assertSameOrigin, clientIp, cookieHeader } from "@/lib/server/auth/http";
import { writeAudit } from "@/lib/server/auth/audit";
import { createSession } from "@/lib/server/auth/session";
import { loadUserByEmail, markLogin } from "@/lib/server/auth/users";
import { verifyPassword } from "@/lib/server/auth/password";
import {
  clearLoginFailures,
  loginAllowed,
  recordLoginFailure,
} from "@/lib/server/auth/rate-limit";
import { isScopedAuthRole } from "@/lib/auth-role";
import { publicUser } from "@/lib/server/auth/types";
import { errorResponse, BffError } from "@/lib/server/upstream";
import { runWithAuth } from "@/lib/server/auth/context";
import { relabelAssignments } from "@/lib/server/auth/scope";
import { filters } from "@/lib/server/bff";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ip = clientIp(request);
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) {
      throw new BffError(400, "invalid_credentials", "Enter your email and password.");
    }
    if (!(await loginAllowed(email, ip))) {
      throw new BffError(
        429,
        "rate_limited",
        "Too many sign-in attempts. Try again in 15 minutes.",
      );
    }

    const user = await loadUserByEmail(email);
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !ok || user.status !== "active") {
      await recordLoginFailure(email, ip);
      throw new BffError(401, "invalid_credentials", "Email or password is incorrect.");
    }

    await clearLoginFailures(email, ip);
    await markLogin(user.id);
    const session = await createSession(user);
    await writeAudit({
      actorId: user.id,
      action: "auth.login",
      ip,
      userAgent: request.headers.get("user-agent") || "",
    });

    const shown = await runWithAuth(user, async () => {
      if (!isScopedAuthRole(user.role) || user.assignments.length === 0) {
        return publicUser(user);
      }
      const options = await filters(new URL(request.url), request.signal);
      return publicUser({
        ...user,
        assignments: relabelAssignments(
          user.assignments,
          options.supervisors,
          options.teams,
        ),
      });
    });

    const response = NextResponse.json(
      { user: shown },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.headers.append("Set-Cookie", cookieHeader(session.token, session.maxAge));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
