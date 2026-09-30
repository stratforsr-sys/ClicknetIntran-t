"use client";

import { useEffect, useState } from "react";
import type { Lkdata, Person } from "@/lib/leveranskalender-server";
import { SLAG_KLASS, endOf, enskildTitel, hm, type Post, type Svar, type Vy } from "@/lib/leveranskalender";
import type { Resultat } from "../moten/actions";
import type { Panellage } from "./Panel";

/** Det varje del av kalendern behöver från roten. */
export type Lk = {
  data: Lkdata;
  personer: Map<string, Person>;
  nu: { dag: string; min: number };
  /** Sökningen, gemener. Tom = ingen sökning. */
  q: string;
  traffar: (p: Post) => boolean;
  vald: string | null;
  setVald: (id: string | null) => void;
  oppnaPanel: (lage: Panellage) => void;
  nyHandelse: (dag?: string, start?: number, minuter?: number) => void;
  efter: (r: Resultat, oppnaEfter?: boolean) => boolean;
  visaKvitto: (text: string, angra?: string) => void;
  ga: (andring: { vy?: Vy; dag?: string; visa?: string[] }) => void;
  /** En förekomst i en serie har dragits: fråga om den här gången eller hela serien. */
  serieflytt: (flytt: { eventId: string; rubrik: string; dag: string; start: number } | null) => void;
};

/**
 * Klockan i Stockholm, dag och minut, uppdaterad varje halvminut. Nu-linjen
 * flyttar sig utan omladdning (AC 3). Räknas i webbläsaren men alltid i svensk
 * tid, så en säljare på resa ser samma nu-linje som kontoret.
 */
export function useNu(): { dag: string; min: number } {
  const [nu, setNu] = useState(() => stockholm());
  useEffect(() => {
    const t = setInterval(() => setNu(stockholm()), 30_000);
    return () => clearInterval(t);
  }, []);
  return nu;
}

function stockholm(): { dag: string; min: number } {
  const delar = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const v = (t: string) => delar.find((d) => d.type === t)?.value ?? "00";
  return { dag: `${v("year")}-${v("month")}-${v("day")}`, min: Number(v("hour")) * 60 + Number(v("minute")) };
}

/** En avatar: initialer, stabil färg per person. */
export function Av({ person, style, className }: { person: Person | undefined; style?: React.CSSProperties; className?: string }) {
  if (!person) return null;
  return (
    <span className={`av c${person.farg}${className ? " " + className : ""}`} style={style} aria-hidden="true">
      {person.kort}
    </span>
  );
}

/** Mitt svar på en post i vyn. En kollegas post i hennes kalender är inte min. */
export function mittSvar(p: Post, mig: string): Svar | null {
  if (p.agare === mig) return p.svar;
  return null;
}

/** `titleFor()`: null = "Upptagen". En kollegas ledighet får hennes namn. */
export function titel(p: Post, lk: Lk): string | null {
  if (p.rubrik === null) return null;
  if (p.slag === "ledig" && p.agare !== lk.data.mig) return `${lk.personer.get(p.agare)?.fornamn ?? ""} ledig`.trim();
  // `baseTitle()`: en 1:1 heter efter den andra — "1:1 Elin" för Zen, "1:1 Zen"
  // för Elin, och "1:1 Zen · Elin" för någon som ser in.
  if (p.slag === "enskilt" && p.organisator) {
    const andra = p.deltagare.find((id) => id !== p.organisator) ?? null;
    return enskildTitel(p.organisator, andra, lk.data.mig, (id) => lk.personer.get(id)?.fornamn ?? "");
  }
  return p.rubrik;
}

/** Klasserna på `.ev`, i prototypens ordning (`evHTML()`). */
export function postklasser(p: Post, lk: Lk, compact: boolean): string {
  const t = titel(p, lk);
  const r = mittSvar(p, lk.data.mig);
  return [
    "ev",
    t === null ? "busyonly" : SLAG_KLASS[p.slag],
    compact ? "compact" : "",
    p.klar ? "done" : "",
    r === "vantar" ? "pending" : r === "kanske" ? "maybe" : r === "nej" ? "declined" : "",
    lk.q && !lk.traffar(p) ? "dim" : "",
    lk.vald && (lk.vald === p.ref || lk.vald === p.id) ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Skärmläsarens etikett: "Genomgång, 09:00–09:30, ej besvarad". */
export function postetikett(p: Post, lk: Lk): string {
  const t = titel(p, lk) ?? "Upptagen";
  const r = mittSvar(p, lk.data.mig);
  const sub = p.klar ? "klar" : r === "vantar" ? "ej besvarad" : r === "kanske" ? "kanske" : r === "nej" ? "avböjt" : "";
  const tid = p.start !== null ? `, ${hm(p.start)}–${hm(endOf(p))}` : "";
  return `${t}${tid}${sub ? ", " + sub : ""}${p.serie ? ", återkommande" : ""}`;
}

/** Får jag dra och ändra längd på posten? Egna möten och egna uppgifter. */
export function farDra(p: Post, lk: Lk): boolean {
  if (!p.ref || p.rubrik === null || p.klar) return false;
  if (p.slag === "mote" || p.slag === "enskilt") return p.organisator === lk.data.mig;
  if (p.slag === "uppgift") return p.agare === lk.data.mig;
  return false;
}

/** Posten öppnar något i panelen (möten, uppgifter, upptagen). Övriga länkar dit de hör. */
export function oppnaPost(p: Post, lk: Lk, router: { push: (href: string) => void }) {
  lk.setVald(p.ref ?? p.id);
  if (p.rubrik === null) {
    lk.oppnaPanel({ typ: "upptagen", post: p });
    return;
  }
  if ((p.slag === "mote" || p.slag === "enskilt") && p.ref) {
    lk.oppnaPanel({ typ: "handelse", id: p.ref });
    return;
  }
  if (p.slag === "uppgift") {
    lk.oppnaPanel({ typ: "uppgift", post: p });
    return;
  }
  if (p.href) router.push(p.href);
}

/** Kan posten öppnas alls? Ledighet och orderfrist är bara information. */
export function klickbar(p: Post): boolean {
  if (p.rubrik === null) return true;
  if (p.slag === "ledig" || p.slag === "order") return false;
  return true;
}

/** Stapelns färg i agendan (`barColor()`). */
export function stapelfarg(p: Post): string {
  if (p.rubrik === null) return "var(--color-ink-300)";
  switch (p.slag) {
    case "leverans":
      return "var(--color-lev)";
    case "enskilt":
    case "coachning":
      return "var(--color-info)";
    case "mote":
      return "var(--color-slate-ink)";
    case "ledig":
      return "var(--color-ok)";
    case "order":
    case "frist":
      return "var(--color-warn)";
    default:
      return "var(--color-ink-300)";
  }
}
