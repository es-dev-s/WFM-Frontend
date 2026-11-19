import { runWithAuth, getAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { writeAudit } from "@/lib/server/auth/audit";
import { assertSameOrigin, clientIp } from "@/lib/server/auth/http";
import { createTransfer, listTransfers } from "@/lib/server/transfers";
import { BffError, errorResponse, jsonResponse } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      if (getAuth().role === "team_lead") {
        throw new BffError(403, "forbidden", "Transfer history is limited to WFM and HR.");
      }
      const page = await listTransfers(new URL(request.url).searchParams, request.signal);
      return jsonResponse(page);
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
      if (getAuth().role !== "wfm") {
        throw new BffError(403, "forbidden", "Only WFM can record transfers.");
      }
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") {
        throw new BffError(400, "invalid_argument", "Request body must be a JSON object.");
      }
      // Allow-list the fields; who recorded it always comes from the session.
      const created = await createTransfer({
        memberId: text(body.memberId),
        employeeName: text(body.employeeName),
        employeeEmail: text(body.employeeEmail),
        previousTeam: text(body.previousTeam),
        newTeam: text(body.newTeam),
        transferDate: text(body.transferDate),
        reason: text(body.reason),
        notes: text(body.notes),
        recordedBy: user.name,
      });
      try {
        await writeAudit({
          actorId: user.id,
          action: "transfer.record",
          targetType: "transfer",
          targetId: created.id,
          meta: {
            employee: created.employeeName,
            from: created.previousTeam,
            to: created.newTeam,
            date: created.transferDate,
          },
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent") || "",
        });
      } catch (error) {
        console.error("transfer audit failed", error instanceof Error ? error.message : error);
      }
      return jsonResponse(created, 201);
    });
  } catch (error) {
    return errorResponse(error);
  }
}
