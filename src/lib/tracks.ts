import { eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { deleteObject, deletePrefix } from "@/lib/s3";

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

export async function deleteTrackStorage(track: PlayableTrack): Promise<void> {
  try {
    if (track.originalKey) await deleteObject(track.originalKey);
    if (track.audioKey) await deleteObject(track.audioKey);
    if (track.artworkKey) await deleteObject(track.artworkKey);
    await deletePrefix(`hls/${track.id}/`);
    await deletePrefix(`pitch/${track.id}/`);
  } catch (error) {
    console.warn(`[tracks] storage cleanup failed (${track.id}):`, error);
  }
}
