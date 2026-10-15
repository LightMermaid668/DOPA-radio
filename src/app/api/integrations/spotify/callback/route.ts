import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getSession } from "@/lib/session";
import {
  exchangeSpotifyCode,
  saveSpotifyTokens,
  spotifyApi,
  spotifyConfigured,
} from "@/lib/spotify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const verifier = cookieStore.get("spotify_code_verifier")?.value;
  const storedState = cookieStore.get("spotify_state")?.value;
  cookieStore.delete("spotify_code_verifier");
  cookieStore.delete("spotify_state");

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?spotify=${reason}`, request.url));

  if (error || !code || !verifier || !state || state !== storedState) {
    return fail("error");
  }
  if (!spotifyConfigured()) {
    return fail("unconfigured");
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login?redirect=/settings", request.url));
  }

  try {
    const tokens = await exchangeSpotifyCode(code, verifier);
    const me = await spotifyApi<{ id?: string }>(tokens.access_token, "/me");
    await saveSpotifyTokens(session.user.id, me.id ?? "unknown", tokens);
  } catch (exchangeError) {
    console.warn("[spotify] callback failed:", exchangeError);
    return fail("error");
  }

  return NextResponse.redirect(new URL("/settings?spotify=connected", request.url));
}
