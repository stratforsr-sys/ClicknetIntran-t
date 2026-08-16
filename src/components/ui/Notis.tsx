import type { ReactNode } from "react";
import { cn } from "./cn";

type Ton = "ok" | "warn" | "danger" | "info";

const TON: Record<Ton, string> = {
  ok: "bg-ok-tint text-ok-ink",
  warn: "bg-warn-tint text-warn-ink",
  danger: "bg-danger-tint text-danger-ink",
  info: "bg-info-tint text-info-ink",
};

/** Inline-besked i formular. Systemet ber inte om ursakt (UI-PRD §8). */
export function Notis({ ton = "info", children }: { ton?: Ton; children: ReactNode }) {
  return (
    <div role="status" className={cn("rounded-sm px-4 py-3 text-small", TON[ton])}>
      {children}
    </div>
  );
}
