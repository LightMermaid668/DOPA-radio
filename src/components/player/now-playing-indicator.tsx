"use client";

import { cn } from "@/lib/utils";

/** 再生中バー（イコライザー風のインジケータ） */
export function NowPlayingIndicator({
  playing,
  className,
}: {
  playing: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("flex h-4 items-end gap-[3px]", className)}
      aria-label={playing ? "再生中" : "一時停止中"}
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className="now-playing-bar w-[3px] rounded-full"
          style={{
            animationDelay: `${index * 0.15}s`,
            animationPlayState: playing ? "running" : "paused",
          }}
        />
      ))}
    </span>
  );
}
