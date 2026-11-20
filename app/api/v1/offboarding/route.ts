import { runWithAuth, getAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { writeAudit } from "@/lib/server/auth/audit";
import { assertSameOrigin, clientIp } from "@/lib/server/auth/http";
import {
  listOffboarding,
  removeOffboarding,
  saveOffboarding,
} from "@/lib/server/offboarding";
import { invalidateOffboardingCache } from "@/lib/server/offboarding-scope";
import { BffError, errorResponse, jsonResponse } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Offboarding is an HR / WFM workflow; team leads never see it. */
function requireHrOrWfm() {
  const user = getAuth();
  if (user.role !== "hr" && user.role !== "wfm") {
    throw new BffError(403, "forbidden", "Offboarding is limited to HR and WFM.");
  }
  return user;
}

async function audit(
  request: Request,
  userId: string,
  action: string,
  targetId: string,
  meta: Record<string, unknown>,
) {
  try {
    await writeAudit({
      actorId: userId,
      action,
      targetType: "offboarding",
      targetId,
      meta,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") || "",
    });
  } catch (error) {
    console.error("offboarding audit failed", error instanceof Error ? error.message : error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      requireHrOrWfm();
      return jsonResponse(await listOffboarding(request.signal));
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Record or update an employee's resignation (one record per employee). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      const actor = requireHrOrWfm();
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") {
        throw new BffError(400, "invalid_argument", "Request body must be a JSON object.");
      }
      // Allow-list the fields; who recorded it always comes from the session.
      const saved = await saveOffboarding({
        memberId: text(body.memberId),
        employeeName: text(body.employeeName),
        employeeEmail: text(body.employeeEmail),
        team: text(body.team),
        resignationDate: text(body.resignationDate),
        lastWorkingDate: text(body.lastWorkingDate),
        reason: text(body.reason),
        notes: text(body.notes),
        recordedBy: actor.name,
      });
      invalidateOffboardingCache();
      await audit(request, actor.id, "offboarding.save", saved.id, {
        employee: saved.employeeName,
        lastWorkingDate: saved.lastWorkingDate,
        effectiveDate: saved.effectiveDate,
      });
      return jsonResponse(saved);
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Withdraw a record (e.g. the resignation was rescinded): DELETE /api/v1/offboarding?id=... */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      const actor = requireHrOrWfm();
      const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
      if (!id) throw new BffError(400, "invalid_argument", "id is required.");
      await removeOffboarding(id);
      invalidateOffboardingCache();
      await audit(request, actor.id, "offboarding.remove", id, {});
      return jsonResponse({ ok: true });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
