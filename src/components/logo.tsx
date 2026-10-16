import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-rainbow animate-rainbow text-lg font-black tracking-tight",
        className,
      )}
    >
      DOPA-radio
    </span>
  );
}
