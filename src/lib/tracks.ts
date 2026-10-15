import { eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";

export type PlayableTrack = typeof tracks.$inferSelect;

export async function findAccessibleTrack(
  trackId: string,
  userId: string | null,
): Promise<PlayableTrack | null> {
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) return null;
  if (track.visibility === "private" && track.ownerId !== userId) return null;
  return track;
}
