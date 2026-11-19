import { BffError } from "@/lib/server/upstream";

const WFM_API_ORIGIN =
  process.env.WFM_API_ORIGIN?.replace(/\/$/, "") || "http://127.0.0.1:18780";

export type TransferRecord = {
  id: string;
  memberId: string;
  employeeName: string;
  employeeEmail: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
};

export type TransferPage = {
  items: TransferRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type TransferInput = {
  memberId?: string;
  employeeName: string;
  employeeEmail?: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason?: string;
  notes?: string;
  recordedBy?: string;
};

async function wfmApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = process.env.WFM_API_TOKEN?.trim();
  if (token && init.method === "POST") headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${WFM_API_ORIGIN}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && init.signal?.aborted) throw error;
    throw new BffError(
      502,
      "network_error",
      "Can’t reach the WFM API. Confirm the backend is running.",
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    // Only 4xx validation messages are safe and useful to show; hide 5xx internals.
    const message =
      response.status >= 400 && response.status < 500 && typeof body.message === "string"
        ? body.message
        : "The WFM API could not complete this request.";
    const status = response.status === 401 ? 502 : response.status;
    throw new BffError(
      status,
      response.status === 401 ? "upstream_auth" : String(body.error || "http_error"),
      response.status === 401 ? "The WFM API rejected this server’s credentials." : message,
    );
  }
  return parsed as T;
}

export function listTransfers(search: URLSearchParams, signal?: AbortSignal): Promise<TransferPage> {
  const params = new URLSearchParams();
  for (const key of ["q", "team", "from", "to", "limit", "offset"]) {
    const value = search.get(key)?.trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return wfmApi<TransferPage>(`/api/v1/transfers${query ? `?${query}` : ""}`, { signal });
}

export function createTransfer(input: TransferInput): Promise<TransferRecord> {
  return wfmApi<TransferRecord>("/api/v1/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
