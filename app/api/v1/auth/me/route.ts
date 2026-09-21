import { isScopedAuthRole } from "@/lib/auth-role";
import { publicUser } from "@/lib/server/auth/types";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { errorResponse, jsonResponse } from "@/lib/server/upstream";
import { relabelAssignments } from "@/lib/server/auth/scope";
import { filters } from "@/lib/server/bff";
import { runWithAuth } from "@/lib/server/auth/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireSessionFromRequest(request);
    if (!isScopedAuthRole(user.role) || user.assignments.length === 0) {
      return jsonResponse({ user: publicUser(user) });
    }
    return await runWithAuth(user, async () => {
      const options = await filters(new URL(request.url), request.signal);
      return jsonResponse({
        user: publicUser({
          ...user,
          assignments: relabelAssignments(
            user.assignments,
            options.supervisors,
            options.teams,
          ),
        }),
      });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
