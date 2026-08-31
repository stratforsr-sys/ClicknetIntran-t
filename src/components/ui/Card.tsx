import type { ReactNode } from "react";
import { cn } from "./cn";

type Status = "ok" | "warn" | "danger" | "info" | "brand";

const KANT: Record<Status, string> = {
  ok: "border-l-[3px] border-l-ok",
  warn: "border-l-[3px] border-l-warn",
  danger: "border-l-[3px] border-l-danger",
  info: "border-l-[3px] border-l-info",
  brand: "border-l-[3px] border-l-brand-500",
};

/**
 * UI-PRD §5.3. Vit yta, radie md, elev-1, INGEN ram.
 * Enda tillatna kantlinjen ar 3 px statusfarg till vanster (AC-U2.4).
 */
export function Card({
  status,
  klickbart = false,
  guide,
  className,
  children,
}: {
  status?: Status;
  klickbart?: boolean;
  /**
   * Ankare for en guidad tur (`data-guide`). Se src/guider/.
   *
   * Ligger som en egen prop och inte som ett godtyckligt attribut med flit:
   * kortet ska inte kunna ta emot vad som helst, och en namngiven prop gor att
   * `npm run test:guider` hittar ankaret dar det star.
   */
  guide?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-guide={guide}
      className={cn(
        "rounded-md bg-surface shadow-elev-1 p-4 md:p-6",
        status && KANT[status],
        klickbart && "lift cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  titel,
  beskrivning,
  handling,
}: {
  titel: string;
  beskrivning?: string;
  handling?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-h2 text-ink-900">{titel}</h2>
        {beskrivning && <p className="mt-1 text-small text-ink-500">{beskrivning}</p>}
      </div>
      {handling && <div className="shrink-0">{handling}</div>}
    </div>
  );
}
