import { requireWfm, runWithAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { writeAudit } from "@/lib/server/auth/audit";
import { createAdminUser, listAdminUsers } from "@/lib/server/auth/users";
import { relabelAssignments } from "@/lib/server/auth/scope";
import { filters } from "@/lib/server/bff";
import { clientIp, assertSameOrigin } from "@/lib/server/auth/http";
import { errorResponse, jsonResponse } from "@/lib/server/upstream";
import type { TeamAssignment } from "@/lib/server/auth/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      requireWfm();
      const options = await filters(new URL(request.url), request.signal);
      const items = (await listAdminUsers()).map((item) => ({
        ...item,
        assignments: relabelAssignments(item.assignments, options.supervisors, options.teams),
      }));
      return jsonResponse({ items });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      requireWfm();
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        email?: string;
        password?: string;
        role?: "wfm" | "team_lead" | "hr";
        assignments?: TeamAssignment[];
      };
      const role = body.role === "wfm" ? "wfm" : body.role === "hr" ? "hr" : "team_lead";
      const options = await filters(new URL(request.url), request.signal);
      const created = await createAdminUser({
        name: String(body.name || ""),
        email: String(body.email || ""),
        password: String(body.password || ""),
        role,
        assignments:
          role === "wfm" || role === "hr"
            ? []
            : relabelAssignments(
                Array.isArray(body.assignments) ? body.assignments : [],
                options.supervisors,
                options.teams,
              ),
        createdBy: user.id,
      });
      await writeAudit({
        actorId: user.id,
        action:
          role === "wfm"
            ? "access.create_superadmin"
            : role === "hr"
              ? "access.create_hr"
              : "access.create_team_lead",
        targetType: "user",
        targetId: created.id,
        meta: { email: created.email, role, teams: created.assignments.length },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      });
      return jsonResponse({ user: created }, 201);
    });
  } catch (error) {
    return errorResponse(error);
  }
}
