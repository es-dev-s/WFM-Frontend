import { query } from "@/lib/server/auth/db";
import type { AuthUser } from "@/lib/server/auth/types";

export async function writeAudit(event: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await query(
    `INSERT INTO wfm_audit_events (id, actor_id, action, target_type, target_id, meta, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      crypto.randomUUID(),
      event.actorId ?? null,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      JSON.stringify(event.meta ?? {}),
      event.ip ?? null,
      event.userAgent ?? null,
    ],
  );
}

export function actorMeta(user: AuthUser | null) {
  return user ? { actor: user.email, role: user.role } : {};
}
