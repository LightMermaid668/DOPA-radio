"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { ScanLine } from "lucide-react";

export function QrScannerButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let stream: MediaStream | null = null;

    function stop() {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      stream = null;
    }

    function handleResult(data: string) {
      let path: string | null = null;
      try {
        const url = new URL(data);
        if (url.pathname.startsWith("/p/") || url.pathname.startsWith("/u/")) {
          path = url.pathname;
        }
      } catch {
        if (data.startsWith("/p/") || data.startsWith("/u/")) path = data;
      }
      if (path) {
        stop();
        setOpen(false);
        router.push(path);
      } else {
        setError("DOPA-radioのQRコードではありません");
      }
    }

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        setError("カメラを起動できませんでした（カメラの使用を許可してください）");
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (cancelled) return;
        const currentVideo = videoRef.current;
        if (currentVideo && ctx && currentVideo.readyState >= currentVideo.HAVE_ENOUGH_DATA) {
          canvas.width = currentVideo.videoWidth;
          canvas.height = currentVideo.videoHeight;
          ctx.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          if (code?.data) {
            handleResult(code.data);
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }

    setError(null);
    void start();

    return stop;
  }, [open, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="QRコードを読み取る"
        className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
      >
        <ScanLine className="size-4.5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-dopa-700 bg-dopa-900 p-4">
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="size-full object-cover"
                aria-label="カメラ映像"
              />
              <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/60" />
            </div>
            {error ? <p className="text-xs text-red-400">{error}</p> : null}
            <p className="text-center text-[11px] text-zinc-500">
              プレイリストやライブラリのQRコードを枠内に写してください
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full border border-dopa-700 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
