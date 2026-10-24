import { LoaderCircle } from "lucide-react";

import { cn } from "~/lib/utils";

// What a send button says while a trigger phrase counts down (use-trigger.ts).

export function countdownTitle(left: number, what: string): string {
  return `${what} in ${left}s. Edit the text to stop it, or click to ${what.toLowerCase()} now`;
}

// A button's labels in one cell, all but the shown one hidden, so the
// button keeps its width as they change.
export function StackedLabel({ labels }: { labels: [string, boolean][] }) {
  return (
    <span className="grid">
      {labels.map(([label, shown]) => (
        <span
          key={label}
          aria-hidden={!shown}
          className={cn(
            "col-start-1 row-start-1 text-center tabular-nums",
            !shown && "invisible",
          )}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

// The send icon, or the spinner while counting down.
export function SendIcon({
  left,
  icon,
}: {
  left: number | null;
  icon: React.ReactNode;
}) {
  return left === null ? icon : <LoaderCircle className="animate-spin" />;
}

// For a button with only an icon: the seconds inside the spinner.
export function CountdownRing({ left }: { left: number }) {
  return (
    <span className="relative grid size-full place-items-center">
      <LoaderCircle className="absolute size-full animate-spin" />
      <span className="text-[9px] font-medium tabular-nums">{left}</span>
    </span>
  );
}
