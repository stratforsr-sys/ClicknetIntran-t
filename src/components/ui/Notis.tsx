import type { ReactNode } from "react";
import { cn } from "./cn";

type Ton = "ok" | "warn" | "danger" | "info";

const TON: Record<Ton, string> = {
  ok: "bg-ok-tint text-ok-ink",
  warn: "bg-warn-tint text-warn-ink",
  danger: "bg-danger-tint text-danger-ink",
  info: "bg-info-tint text-info-ink",
};

/**
 * Inline-besked i formular. Systemet ber inte om ursakt (UI-PRD §8).
 *
 * ===========================================================================
 * X1 / WCAG 4.1.3 Status Messages (niva AA): TONEN AVGOR HUR DET ANNONSERAS
 *
 * Alla toner delade forut `role="status"`, som ar en POLITE live region: en
 * skarmlasare laser upp den nar den ar klar med det den hall pa med. For "Tack,
 * rapporten ligger i kon" ar det ratt.
 *
 * For ett FEL ar det fel. Den som just tryckt "Spara" och fatt ett avslag maste
 * fa veta det innan hen borjar gora nagot annat — och med `role="status"` kan
 * beskedet komma efter att fokus redan flyttat vidare, eller drunkna i det som
 * lases upp fore. `role="alert"` ar assertive och avbryter.
 *
 * Bara `danger` far det. Att gora alla toner assertive vore att lara anvandaren
 * att avbrott inte betyder nagot — samma skal som gor att bara ett kort pa
 * startsidan ritas nar nagot ar fel.
 * ===========================================================================
 */
export function Notis({ ton = "info", children }: { ton?: Ton; children: ReactNode }) {
  return (
    <div
      role={ton === "danger" ? "alert" : "status"}
      className={cn("rounded-sm px-4 py-3 text-small", TON[ton])}
    >
      {children}
    </div>
  );
}
