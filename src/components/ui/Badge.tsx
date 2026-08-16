import type { ReactNode } from "react";
import { cn } from "./cn";

type Ton = "ok" | "warn" | "danger" | "info" | "brand" | "neutral" | "accent";

/**
 * UI-PRD §5.5. Tonad bakgrund med morkare text — aldrig mattad farg med vit
 * text, det drar for mycket uppmarksamhet i en tabell.
 * AC-U5.2: status kommuniceras aldrig med enbart farg, darfor alltid ett ord.
 */
const TON: Record<Ton, string> = {
  ok: "bg-ok-tint text-ok-ink",
  warn: "bg-warn-tint text-warn-ink",
  danger: "bg-danger-tint text-danger-ink",
  info: "bg-info-tint text-info-ink",
  brand: "bg-brand-tint text-brand-ink",
  accent: "bg-accent-tint text-accent-ink",
  neutral: "bg-canvas text-ink-500",
};

export function Badge({ ton = "neutral", children }: { ton?: Ton; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-micro uppercase whitespace-nowrap",
        TON[ton],
      )}
    >
      {children}
    </span>
  );
}

/** Cirkular raknare. Accentfarg = kraver handling (UI-PRD §5.1). */
export function Counter({ antal, ton = "accent" }: { antal: number; ton?: "accent" | "brand" }) {
  if (antal <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-micro tabular-nums",
        ton === "accent" ? "bg-accent text-accent-ink" : "bg-brand-500 text-brand-950",
      )}
    >
      {antal > 99 ? "99+" : antal}
    </span>
  );
}
