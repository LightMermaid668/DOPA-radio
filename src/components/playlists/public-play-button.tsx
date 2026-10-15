"use client";

import { useRouter } from "next/navigation";
import { LogIn, Play, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { usePlayer, type PlayerTrack } from "@/stores/player";

export type PublicTrack = PlayerTrack;

export function PublicPlayButton({
  redirectTo,
  tracks,
}: {
  redirectTo: string;
  tracks: PublicTrack[];
}) {
  const router = useRouter();
  const { data: session } = useSession();

  if (!session) {
    return (
      <Button
        type="button"
        size="lg"
        onClick={() => router.push(`/login?redirect=${encodeURIComponent(redirectTo)}`)}
      >
        <LogIn className="size-4" />
        ログインして再生
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="lg"
        disabled={tracks.length === 0}
        onClick={() => {
          if (tracks.length === 0) return;
          usePlayer.getState().playQueue(tracks, 0);
        }}
      >
        <Play className="size-4" />
        再生
      </Button>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={tracks.length === 0}
        onClick={() => {
          if (tracks.length === 0) return;
          usePlayer.getState().playQueueShuffled(tracks);
        }}
        aria-label="シャッフル再生"
      >
        <Shuffle className="size-4" />
        シャッフル
      </Button>
    </div>
  );
}
