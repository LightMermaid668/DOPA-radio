import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { eq } from "drizzle-orm";
import { parseFile } from "music-metadata";
import sharp from "sharp";

import { db } from "../../src/db";
import { tracks } from "../../src/db/schema";
import {
  deletePrefix,
  getObjectToFile,
  putObjectBuffer,
  putObjectFile,
} from "../../src/lib/s3";

const execFileAsync = promisify(execFile);

type FfprobeResult = {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string }>;
};

async function ffprobe(filePath: string): Promise<FfprobeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-show_entries",
    "stream=codec_type,codec_name",
    "-of",
    "json",
    filePath,
  ]);
  return JSON.parse(stdout) as FfprobeResult;
}

export async function transcodeTrack(trackId: string): Promise<void> {
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) });
  if (!track) throw new Error(`track not found: ${trackId}`);
  if (!track.originalKey) throw new Error(`originalKey missing: ${trackId}`);

  const workDir = await mkdtemp(path.join(tmpdir(), "dopa-transcode-"));

  try {
    await db
      .update(tracks)
      .set({ status: "processing", transcodeError: null })
      .where(eq(tracks.id, trackId));

    const originalPath = path.join(workDir, "original.bin");
    await getObjectToFile(track.originalKey, originalPath);

    const probe = await ffprobe(originalPath);
    const duration = Number(probe.format?.duration ?? 0);
    const hasAudio = (probe.streams ?? []).some((s) => s.codec_type === "audio");
    if (!hasAudio) throw new Error("音声ストリームが見つかりません");
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("再生時間を取得できませんでした");

    let title = track.title;
    let artist = track.artist;
    let album = track.album;
    let genre = track.genre;
    let artworkBuffer: Buffer | null = null;

    try {
      const meta = await parseFile(originalPath);
      if (meta.common.title) title = meta.common.title;
      if (meta.common.artist) artist = meta.common.artist;
      if (meta.common.album) album = meta.common.album;
      if (meta.common.genre?.length) genre = meta.common.genre[0] ?? null;
      const picture = meta.common.picture?.[0];
      if (picture) {
        artworkBuffer = await sharp(Buffer.from(picture.data))
          .resize(600, 600, { fit: "cover" })
          .webp({ quality: 82 })
          .toBuffer();
      }
    } catch (error) {
      console.warn(`[transcode] metadata extraction failed (${trackId}):`, error);
    }

    const audioPath = path.join(workDir, "audio.m4a");
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      originalPath,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      audioPath,
    ]);

    const hlsDir = path.join(workDir, "hls");
    await mkdir(hlsDir, { recursive: true });
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      originalPath,
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(hlsDir, "seg_%05d.ts"),
      path.join(hlsDir, "index.m3u8"),
    ]);

    const audioKey = `audio/${trackId}.m4a`;
    const hlsKey = `hls/${trackId}/index.m3u8`;

    await deletePrefix(`hls/${trackId}/`);
    await putObjectFile(audioKey, audioPath, "audio/mp4");

    const hlsFiles = (await readdir(hlsDir)).sort();
    for (const file of hlsFiles) {
      const contentType = file.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp2t";
      await putObjectFile(`hls/${trackId}/${file}`, path.join(hlsDir, file), contentType);
    }

    let artworkKey = track.artworkKey;
    if (artworkBuffer) {
      artworkKey = `artwork/${trackId}.webp`;
      await putObjectBuffer(artworkKey, artworkBuffer, "image/webp");
    }

    await db
      .update(tracks)
      .set({
        status: "ready",
        transcodeError: null,
        durationSec: Math.round(duration),
        audioKey,
        hlsKey,
        artworkKey,
        title,
        artist,
        album,
        genre,
        updatedAt: new Date(),
      })
      .where(eq(tracks.id, trackId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(tracks)
      .set({ status: "failed", transcodeError: message.slice(0, 500) })
      .where(eq(tracks.id, trackId));
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
