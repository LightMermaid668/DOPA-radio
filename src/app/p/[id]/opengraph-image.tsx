import { ImageResponse } from "next/og";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, tracks } from "@/db/schema";
import { getObjectBuffer } from "@/lib/s3";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "DOPA-radio playlist";

export default async function PlaylistOgImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let artworkDataUrl: string | null = null;
  let trackCount = 0;

  try {
    const playlist = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
    if (playlist && playlist.visibility !== "private") {
      const items = await db
        .select({
          artworkKey: tracks.artworkKey,
          externalMeta: playlistItems.externalMeta,
        })
        .from(playlistItems)
        .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
        .where(eq(playlistItems.playlistId, id))
        .orderBy(asc(playlistItems.position));
      trackCount = items.length;

      const artworkKey = items.find((item) => item.artworkKey)?.artworkKey;
      if (artworkKey) {
        const buffer = await getObjectBuffer(artworkKey);
        artworkDataUrl = `data:image/webp;base64,${buffer.toString("base64")}`;
      } else {
        const externalArtwork = items.find(
          (item) => item.externalMeta?.artworkUrl,
        )?.externalMeta?.artworkUrl;
        if (externalArtwork) {
          const res = await fetch(externalArtwork, { cache: "no-store" });
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const contentType = res.headers.get("content-type") ?? "image/jpeg";
            artworkDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
          }
        }
      }
    }
  } catch (error) {
    console.warn("[og] playlist image generation failed:", error);
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          backgroundColor: "#0a0a0c",
        }}
      >
        {artworkDataUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={artworkDataUrl}
            width={1200}
            height={630}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.35,
            }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                background:
                  "linear-gradient(135deg, #ff5f6d, #f7e463, #4ade80, #38bdf8, #a78bfa)",
                display: "flex",
              }}
            />
            <span style={{ color: "white", fontSize: 40, fontWeight: 800 }}>DOPA-radio</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ color: "#e879f9", fontSize: 28, fontWeight: 700, letterSpacing: 6 }}>
              PLAYLIST
            </span>
            <span style={{ color: "white", fontSize: 44, fontWeight: 700 }}>
              {`${trackCount} tracks`}
            </span>
            <span style={{ color: "#a1a1aa", fontSize: 24 }}>
              dopa-radio.sosukeiwasaki.f5.si
            </span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
