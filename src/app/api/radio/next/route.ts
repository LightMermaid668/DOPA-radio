import { NextResponse } from "next/server";
import { and, eq, notInArray, or } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { getSession } from "@/lib/session";

const LIMIT = 5;
const CANDIDATE_LIMIT = 300;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const url = new URL(request.url);
  const seedId = url.searchParams.get("seed");
  const excludeParam = url.searchParams.get("exclude") ?? "";
  const excludeIds = excludeParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const seedTrack = seedId
    ? await db.query.tracks.findFirst({ where: eq(tracks.id, seedId) })
    : null;

  const conditions = [
    eq(tracks.status, "ready"),
    or(eq(tracks.visibility, "public"), eq(tracks.ownerId, session.user.id)),
  ];
  if (excludeIds.length > 0) {
    conditions.push(notInArray(tracks.id, excludeIds));
  }

  const candidates = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      genre: tracks.genre,
      tags: tracks.tags,
      durationSec: tracks.durationSec,
      artworkKey: tracks.artworkKey,
      playCount: tracks.playCount,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
    })
    .from(tracks)
    .where(and(...conditions))
    .limit(CANDIDATE_LIMIT);

  const scored = candidates.map((candidate) => {
    let score = 0;
    if (seedTrack) {
      if (seedTrack.genre && candidate.genre === seedTrack.genre) score += 40;
      if (
        seedTrack.artist &&
        candidate.artist &&
        candidate.artist === seedTrack.artist
      ) {
        score += 30;
      }
      const seedTags = seedTrack.tags ?? [];
      const overlap = (candidate.tags ?? []).filter((tag) => seedTags.includes(tag)).length;
      score += overlap * 15;
    }
    score += Math.min(candidate.playCount, 20);
    return { candidate, score, noise: Math.random() };
  });

  scored.sort((a, b) => b.score - a.score || a.noise - b.noise);

  const picked = scored.slice(0, LIMIT).map((entry) => ({
    id: entry.candidate.id,
    title: entry.candidate.title,
    artist: entry.candidate.artist,
    durationSec: entry.candidate.durationSec,
    hasArtwork: Boolean(entry.candidate.artworkKey),
    chorusStartSec: entry.candidate.chorusStartSec,
    chorusEndSec: entry.candidate.chorusEndSec,
  }));

  return NextResponse.json({ tracks: picked });
}
