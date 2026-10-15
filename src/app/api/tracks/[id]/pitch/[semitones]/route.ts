import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { trackPitchVariants } from "@/db/schema";
import { enqueuePitchVariant } from "@/lib/jobs";
import { presignGet } from "@/lib/s3";
import { getSession } from "@/lib/session";
import { findAccessibleTrack } from "@/lib/tracks";

const MIN_SEMITONES = -12;
const MAX_SEMITONES = 12;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; semitones: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id, semitones: rawSemitones } = await params;
  const semitones = Number(rawSemitones);
  if (
    !Number.isInteger(semitones) ||
    semitones === 0 ||
    semitones < MIN_SEMITONES ||
    semitones > MAX_SEMITONES
  ) {
    return NextResponse.json({ error: "半音の指定が不正です" }, { status: 400 });
  }

  const track = await findAccessibleTrack(id, session.user.id);
  if (!track || track.status !== "ready") {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }

  const check = new URL(request.url).searchParams.get("check") === "1";

  const variantWhere = and(
    eq(trackPitchVariants.trackId, track.id),
    eq(trackPitchVariants.semitones, semitones),
  );

  let variant = await db.query.trackPitchVariants.findFirst({ where: variantWhere });

  if (!variant || variant.status === "failed") {
    variant = (
      await db
        .insert(trackPitchVariants)
        .values({ trackId: track.id, semitones, status: "processing" })
        .onConflictDoUpdate({
          target: [trackPitchVariants.trackId, trackPitchVariants.semitones],
          set: { status: "processing", error: null, updatedAt: new Date() },
        })
        .returning()
    )[0];
    await enqueuePitchVariant(track.id, semitones);
  }

  if (variant.status === "processing") {
    if (check) {
      return NextResponse.json({ status: "processing" }, { status: 202 });
    }
    return NextResponse.json({ status: "processing" }, { status: 202 });
  }

  if (check) {
    return NextResponse.json({ status: "ready" });
  }

  return NextResponse.redirect(await presignGet(`pitch/${track.id}/${semitones}.m4a`), 302);
}
