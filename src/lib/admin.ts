import { headers } from "next/headers";

import { auth } from "@/lib/auth";

const DEFAULT_ADMINS = "LightMermaid668@gmail.com";

export function adminEmails(): string[] {
  // 空文字で設定された場合はデフォルトにフォールバック（管理者ロックアウト防止）
  return (process.env.ADMIN_EMAILS?.trim() || DEFAULT_ADMINS)
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
