import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";

const baseURL = process.env.BETTER_AUTH_URL;
// ログイン状態が長持ちするように（30日・1日ごとに自動延長）
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export const auth = betterAuth({
  appName: "DOPA-radio",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    expiresIn: SESSION_MAX_AGE_SEC,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // すべての認証Cookieを永続化（ブラウザ/アプリを閉じても消えない）
    defaultCookieAttributes: {
      maxAge: SESSION_MAX_AGE_SEC,
      sameSite: "lax",
    },
  },
  trustedOrigins: [
    ...(baseURL ? [baseURL] : []),
    "http://localhost:3000",
    "http://localhost:3001",
  ],
});

export type Session = typeof auth.$Infer.Session;
