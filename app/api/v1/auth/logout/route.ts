import { NextResponse } from "next/server";
import { assertSameOrigin, expireCookieHeader, readCookie } from "@/lib/server/auth/http";
import { destroySession } from "@/lib/server/auth/session";
import { writeAudit } from "@/lib/server/auth/audit";
import { getSessionFromRequest } from "@/lib/server/auth/request";
import { errorResponse } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const token = readCookie(request.headers.get("cookie"));
    const user = await getSessionFromRequest(request);
    await destroySession(token);
    if (user) {
      await writeAudit({
        actorId: user.id,
        action: "auth.logout",
        ip: request.headers.get("x-forwarded-for") || "",
        userAgent: request.headers.get("user-agent") || "",
      });
    }
    const response = NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.headers.append("Set-Cookie", expireCookieHeader(request));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
