"use client";

import { useRouter } from "next/navigation";
import { LogIn, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { usePlayer } from "@/stores/player";

export type PublicTrack = {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
};

export function PublicPlayButton({
  playlistId,
  tracks,
}: {
  playlistId: string;
  tracks: PublicTrack[];
}) {
  const router = useRouter();
  const { data: session } = useSession();

  if (!session) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => router.push(`/login?redirect=/p/${playlistId}`)}
      >
        <LogIn className="size-4" />
        ログインして再生
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="lg"
      disabled={tracks.length === 0}
      onClick={() => {
        if (tracks.length === 0) return;
        usePlayer.getState().playQueue(
          tracks.map((track) => ({
            id: track.id,
            title: track.title,
            artist: track.artist,
            durationSec: track.durationSec,
            artworkUrl: `/api/tracks/${track.id}/artwork`,
          })),
          0,
        );
      }}
    >
      <Play className="size-4" />
      再生
    </Button>
  );
}
