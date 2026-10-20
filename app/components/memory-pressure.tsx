import { MemoryStick } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { MemoryPressure, MemoryUsage } from "~/lib/board";
import { cn } from "~/lib/utils";

const PRESSURE: Record<MemoryPressure, string> = {
  normal: "macOS reports no memory pressure.",
  warn: "macOS reports memory pressure: it is compressing and swapping to keep up, and every new chat adds to it.",
  critical:
    "macOS reports critical memory pressure and may close apps, chats included. Close a chat before starting another.",
};

const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`;

export function memoryTitle(memory: MemoryUsage): string {
  return [
    `macOS counts ${100 - memory.load}% of memory as still available.`,
    `Using ${gb(memory.used)} of ${gb(memory.total)} memory, with ${gb(memory.swapUsed)} of ${gb(memory.swapTotal)} swap in use.`,
    PRESSURE[memory.pressure],
  ].join(" ");
}

// Beside LAN and Remote in the header: how much of memory the kernel no
// longer counts as available, coloured by its pressure level, which is what
// decides when macOS closes apps.
export function MemoryBadge({
  memory,
  className,
}: {
  memory: MemoryUsage | null;
  className?: string;
}) {
  if (!memory) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs tabular-nums",
        memory.pressure === "critical"
          ? "text-destructive"
          : memory.pressure === "warn"
            ? "text-warning-text"
            : "text-muted-foreground",
        className,
      )}
      title={memoryTitle(memory)}
    >
      <MemoryStick className="size-3.5" />
      {memory.load}%
    </span>
  );
}

// Asked before starting another chat on a loaded Mac.
export function LoadedConfirm({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start another chat on a loaded Mac?</DialogTitle>
          <DialogDescription>
            macOS reports critical memory pressure. Every chat is its own
            process, and past this point macOS closes apps to free memory, chats
            mid-turn among them. Closing a chat first frees some.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Start it anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
