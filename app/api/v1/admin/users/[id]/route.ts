import { requireWfm, runWithAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { writeAudit } from "@/lib/server/auth/audit";
import { deleteAdminUser, updateAdminUser } from "@/lib/server/auth/users";
import { relabelAssignments } from "@/lib/server/auth/scope";
import { filters } from "@/lib/server/bff";
import { clientIp, assertSameOrigin, readCookie } from "@/lib/server/auth/http";
import { peekSessionId } from "@/lib/server/auth/session";
import { errorResponse, jsonResponse, BffError } from "@/lib/server/upstream";
import type { TeamAssignment } from "@/lib/server/auth/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionFromRequest(request);
    const { id } = await context.params;
    if (!id) throw new BffError(400, "invalid_id", "Missing user id.");
    return await runWithAuth(user, async () => {
      requireWfm();
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        email?: string;
        role?: "wfm" | "team_lead" | "hr";
        status?: "active" | "disabled";
        password?: string;
        assignments?: TeamAssignment[];
      };
      if (Array.isArray(body.assignments) && body.role !== "wfm" && body.role !== "hr") {
        const options = await filters(new URL(request.url), request.signal);
        body.assignments = relabelAssignments(
          body.assignments,
          options.supervisors,
          options.teams,
        );
      }
      const sessionId = await peekSessionId(readCookie(request.headers.get("cookie")));
      const updated = await updateAdminUser(id, body, user.id, sessionId ?? undefined);
      await writeAudit({
        actorId: user.id,
        action: "access.update_user",
        targetType: "user",
        targetId: updated.id,
        meta: { role: updated.role, status: updated.status, teams: updated.assignments.length },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      });
      return jsonResponse({ user: updated });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionFromRequest(request);
    const { id } = await context.params;
    if (!id) throw new BffError(400, "invalid_id", "Missing user id.");
    return await runWithAuth(user, async () => {
      requireWfm();
      const removed = await deleteAdminUser(id, user.id);
      await writeAudit({
        actorId: user.id,
        action: "access.delete_user",
        targetType: "user",
        targetId: removed.id,
        meta: { email: removed.email, name: removed.name, role: removed.role },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") || "",
      });
      return jsonResponse({ ok: true, user: removed });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
