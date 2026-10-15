import { getObjectBuffer, presignGet } from "@/lib/s3";
import { getSession } from "@/lib/session";
import { findAccessibleTrack } from "@/lib/tracks";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const track = await findAccessibleTrack(id, session.user.id);
  if (!track || track.status !== "ready" || !track.hlsKey) {
    return Response.json({ error: "トラックが見つかりません" }, { status: 404 });
  }

  const playlist = (await getObjectBuffer(track.hlsKey)).toString("utf8");
  const prefix = track.hlsKey.slice(0, track.hlsKey.lastIndexOf("/") + 1);

  const lines = playlist.split("\n");
  const rewritten: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      rewritten.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const url = await presignGet(prefix + uriMatch[1]);
        rewritten.push(trimmed.replace(uriMatch[1], url));
      } else {
        rewritten.push(line);
      }
      continue;
    }
    rewritten.push(await presignGet(prefix + trimmed));
  }

  return new Response(rewritten.join("\n"), {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "private, no-store",
    },
  });
}
