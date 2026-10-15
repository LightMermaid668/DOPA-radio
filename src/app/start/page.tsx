import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * PWA（ホーム画面アプリ）の起動入口。
 * ランディングページを挟まず、ログイン状態に応じてアプリ本体へ直行する。
 */
export default async function StartPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/home");
  redirect("/login?redirect=/home");
}
