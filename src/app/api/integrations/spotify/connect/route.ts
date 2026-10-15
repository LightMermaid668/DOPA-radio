import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getSession } from "@/lib/session";
import { buildSpotifyAuthorizeUrl, spotifyConfigured } from "@/lib/spotify";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login?redirect=/settings", request.url));
  }
  if (!spotifyConfigured()) {
    return NextResponse.redirect(new URL("/settings?spotify=unconfigured", request.url));
  }

  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set("spotify_code_verifier", verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  cookieStore.set("spotify_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildSpotifyAuthorizeUrl(state, challenge));
}
