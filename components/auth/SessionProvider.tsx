"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/api";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSession must be used within SessionProvider");
  return user;
}

export function useSessionOptional(): SessionUser | null {
  return useContext(SessionContext);
}
