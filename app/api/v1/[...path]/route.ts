import { handleBff } from "@/lib/server/bff";
import { runWithAuth } from "@/lib/server/auth/context";
import { requireSessionFromRequest } from "@/lib/server/auth/request";
import { errorResponse, jsonResponse } from "@/lib/server/upstream";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const user = await requireSessionFromRequest(request);
    const { path } = await context.params;
    const body = await runWithAuth(user, () => handleBff(path ?? [], request));
    return jsonResponse(body);
  } catch (error) {
    return errorResponse(error);
  }
}
