"use client";

import { cn } from "@/components/ui/cn";

/**
 * Småbitarna som både "Notiser och mejl" (den egna inställningen) och
 * Utskick (superadmins vy) ritas av. Ingen logik här, bara former.
 */

/** På/av. Träffytan är 44 px, det synliga reglaget mindre. */
export function Brytare({
  pa,
  onVal,
  etikett,
  last = false,
}: {
  pa: boolean;
  onVal: (pa: boolean) => void;
  etikett: string;
  /** Stängd av superadmin: går inte att slå på. */
  last?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pa}
      aria-label={etikett}
      disabled={last}
      onClick={() => onVal(!pa)}
      className={cn(
        "group grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-45",
      )}
    >
      <span
        className={cn(
          "relative block h-6 w-10 rounded-full transition-colors duration-fast ease-brand",
          pa ? "bg-brand-600" : "bg-ink-300/50",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow-elev-1",
            "transition-transform duration-fast ease-brand",
            pa && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

/** Ärv / På / Av. `null` är Ärv. */
export function Tri({
  varde,
  onVal,
  etikett,
}: {
  varde: boolean | null;
  onVal: (v: boolean | null) => void;
  etikett: string;
}) {
  const val: { v: boolean | null; t: string; ton: string }[] = [
    { v: null, t: "Ärv", ton: "text-ink-900" },
    { v: true, t: "På", ton: "text-ok-ink" },
    { v: false, t: "Av", ton: "text-danger-ink" },
  ];
  return (
    <div role="radiogroup" aria-label={etikett} className="inline-flex shrink-0 gap-0.5 rounded-full bg-canvas p-0.5">
      {val.map((o) => {
        const aktiv = o.v === varde;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={aktiv}
            onClick={() => !aktiv && onVal(o.v)}
            className={cn(
              "min-h-8 rounded-full px-3 text-small transition-[background-color,box-shadow,color] duration-fast ease-brand",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
              aktiv ? cn("bg-surface font-semibold shadow-elev-1", o.ton) : "text-ink-500 hover:text-ink-900",
            )}
          >
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

/** En tick per område: fylld när något i området går fram. Räknaren i bild. */
export function Matare({ pa, av, etikett }: { pa: number; av: number; etikett: string }) {
  return (
    <div className="flex items-center gap-3">
      <span role="img" aria-label={etikett} className="flex items-end gap-0.5">
        {Array.from({ length: av }, (_, i) => (
          <span
            key={i}
            className={cn(
              "block h-3 w-1 rounded-full transition-colors duration-fast ease-brand",
              i < pa ? "bg-brand-600" : "bg-ink-300/40",
            )}
          />
        ))}
      </span>
      <span className="tnum text-small text-ink-500">
        <b className="font-semibold text-ink-900">{pa}</b> av {av} områden på
      </span>
    </div>
  );
}

/** Pil som vrids när raden är öppen. */
export function Veck({ oppen }: { oppen: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0 text-ink-300 transition-transform duration-fast ease-brand", oppen && "rotate-90")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
