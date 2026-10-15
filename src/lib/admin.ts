import { headers } from "next/headers";

import { auth } from "@/lib/auth";

const DEFAULT_ADMINS = "LightMermaid668@gmail.com";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? DEFAULT_ADMINS)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null): boolean {
  return Boolean(email) && adminEmails().includes((email as string).toLowerCase());
}

export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) return null;
  return session;
}
