import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decryptText, encryptText } from "@/lib/crypto";
import type { ExternalTrack } from "@/lib/apple";

const SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

export function spotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID);
}

export function spotifyRedirectUri(): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base}/api/integrations/spotify/callback`;
}

export function buildSpotifyAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  if (process.env.SPOTIFY_CLIENT_SECRET) {
    body.set("client_secret", process.env.SPOTIFY_CLIENT_SECRET);
  }
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify token request failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeSpotifyCode(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
      client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
      code_verifier: codeVerifier,
    }),
  );
}

async function refreshSpotifyToken(refreshToken: string): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    }),
  );
}

export async function spotifyApi<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`spotify api failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function getSpotifyAccessToken(userId: string): Promise<string | null> {
  const row = await db.query.integrations.findFirst({
    where: and(eq(integrations.userId, userId), eq(integrations.provider, "spotify")),
  });
  if (!row?.accessToken) return null;

  const expiresAt = row.expiresAt?.getTime() ?? 0;
  if (Date.now() < expiresAt - 60_000) {
    return decryptText(row.accessToken);
  }

  if (!row.refreshToken) return null;
  const refreshed = await refreshSpotifyToken(decryptText(row.refreshToken));
  await db
    .update(integrations)
    .set({
      accessToken: encryptText(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, row.id));
  return refreshed.access_token;
}

export async function saveSpotifyTokens(
  userId: string,
  providerUserId: string,
  tokens: TokenResponse,
) {
  const values = {
    userId,
    provider: "spotify" as const,
    providerUserId,
    accessToken: encryptText(tokens.access_token),
    refreshToken: tokens.refresh_token ? encryptText(tokens.refresh_token) : null,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scope: tokens.scope ?? null,
    updatedAt: new Date(),
  };

  const existing = await db.query.integrations.findFirst({
    where: and(eq(integrations.userId, userId), eq(integrations.provider, "spotify")),
  });
  if (existing) {
    await db
      .update(integrations)
      .set({
        ...values,
        refreshToken: values.refreshToken ?? existing.refreshToken,
      })
      .where(eq(integrations.id, existing.id));
    return;
  }
  await db.insert(integrations).values(values);
}

export async function disconnectSpotify(userId: string) {
  await db
    .delete(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "spotify")));
}

type SpotifyTrackResult = {
  id: string;
  name: string;
  duration_ms?: number;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string; width?: number }> };
  external_urls?: { spotify?: string };
  uri?: string;
};

export function mapSpotifyTrack(track: SpotifyTrackResult): ExternalTrack & { uri: string | null } {
  const image =
    track.album?.images?.find((item) => (item.width ?? 0) >= 300) ?? track.album?.images?.[0];
  return {
    externalId: track.id,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name).filter(Boolean).join(", ") ?? "",
    album: track.album?.name ?? null,
    artworkUrl: image?.url ?? null,
    durationMs: track.duration_ms ?? null,
    deepLink: track.external_urls?.spotify ?? null,
    previewUrl: null,
    uri: track.uri ?? null,
  };
}

export async function searchSpotifyTracks(
  accessToken: string,
  term: string,
  limit = 12,
): Promise<Array<ExternalTrack & { uri: string | null }>> {
  const params = new URLSearchParams({
    q: term,
    type: "track",
    limit: String(limit),
    market: "JP",
  });
  const data = await spotifyApi<{ tracks?: { items?: SpotifyTrackResult[] } }>(
    accessToken,
    `/search?${params.toString()}`,
  );
  return (data.tracks?.items ?? []).map(mapSpotifyTrack);
}

export async function lookupSpotifyTrack(
  accessToken: string,
  trackId: string,
): Promise<(ExternalTrack & { uri: string | null }) | null> {
  try {
    const track = await spotifyApi<SpotifyTrackResult>(accessToken, `/tracks/${trackId}`);
    return mapSpotifyTrack(track);
  } catch {
    return null;
  }
}
