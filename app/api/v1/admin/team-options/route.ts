import { requireWfm, runWithAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { filters } from "@/lib/server/bff";
import { errorResponse, jsonResponse } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireSessionFromRequest(request);
    return await runWithAuth(user, async () => {
      requireWfm();
      const url = new URL(request.url);
      url.searchParams.set("complete", "1");
      const options = await filters(url, request.signal);
      return jsonResponse({
        tivazo: options.supervisors,
        biometrics: options.teams,
      });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
