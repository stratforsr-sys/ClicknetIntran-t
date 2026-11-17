/**
 * Kunskapsbasen: det rena (0312, PRD:n 2026-11-16).
 *
 * Ett dokument delas i stycken som ryms i det chatten läser (`DOKUMENT_TECKEN`
 * i chatt/verktyg.ts), så att ett långt dokument går att hitta i. Delningen
 * sker vid rubrikerna, och små avsnitt intill varandra hålls ihop: ett kort
 * dokument blir ett enda stycke. En mening delas aldrig om den ryms, eftersom
 * chatten bara får säga ett tal ur ett dokument som ett ordagrant citat av en
 * hel mening.
 *
 * Ren, så att provet går med `node --experimental-strip-types`.
 */

/** Så långt får ett stycke vara. Under det chatten läser ur ett dokument, så att inget kapas. */
export const STYCKE_MAX = 2500;
export const TEXT_MAX = 400_000;
export const TITEL_MAX = 160;
export const OMRADE_MAX = 80;
/** Filen läses i webbläsaren och skickas som text i begäran. Tre megabyte ryms under Vercels tak. */
export const FIL_MAX_BYTES = 3 * 1024 * 1024;
export const FILSORTER = [".pdf", ".txt", ".md"] as const;

export type Stycke = { rubrik: string; text: string };

const RUBRIK = /^#{1,6}\s+(.+?)\s*#*\s*$/;

/** Delar en text som är för lång: först vid tomrader, sedan vid radbrytningar, sedan vid meningsslut, sist mitt i. */
function dela(text: string, max: number): string[] {
  const ut: string[] = [];
  let nu = "";
  const lagg = (del: string, skilje: string) => {
    if (!del.trim()) return;
    if (nu && nu.length + skilje.length + del.length > max) { ut.push(nu); nu = ""; }
    nu = nu ? nu + skilje + del : del;
  };
  for (const st of text.split(/\n{2,}/)) {
    if (st.length <= max) { lagg(st, "\n\n"); continue; }
    for (const rad of st.split("\n")) {
      if (rad.length <= max) { lagg(rad, "\n"); continue; }
      for (const men of rad.split(/(?<=[.!?])\s+/)) for (let i = 0; i < men.length; i += max) lagg(men.slice(i, i + max), " ");
    }
  }
  if (nu) ut.push(nu);
  return ut;
}

export function delaIStycken(text: string, max: number = STYCKE_MAX): Stycke[] {
  const avsnitt: Stycke[] = [];
  let nu = { rubrik: "", rader: [] as string[] };
  const stang = () => { const t = nu.rader.join("\n").trim(); if (t) avsnitt.push({ rubrik: nu.rubrik, text: t }); };
  for (const rad of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const m = RUBRIK.exec(rad);
    if (m) { stang(); nu = { rubrik: m[1].trim().slice(0, 120), rader: [] }; } else nu.rader.push(rad.replace(/\s+$/, ""));
  }
  stang();

  const ut: { rubriker: string[]; text: string }[] = [];
  for (const a of avsnitt) {
    const huvud = a.rubrik ? `## ${a.rubrik}\n` : "";
    for (const bit of dela(a.text, max - huvud.length)) {
      const del = huvud + bit, sist = ut[ut.length - 1];
      if (sist && sist.text.length + 2 + del.length <= max) {
        sist.text += `\n\n${del}`;
        if (a.rubrik && !sist.rubriker.includes(a.rubrik)) sist.rubriker.push(a.rubrik);
      } else ut.push({ rubriker: a.rubrik ? [a.rubrik] : [], text: del });
    }
  }
  return ut.map((u) => ({ rubrik: u.rubriker.join(", ").slice(0, 200), text: u.text }));
}

export type Dokumentfalt = { titel: string; omrade: string; text: string };

/** Det som kommer in från formuläret: trimmat och prövat, eller ett fel att visa. */
export function provaDokument(b: { titel?: unknown; omrade?: unknown; text?: unknown }): { ok: true; falt: Dokumentfalt } | { ok: false; fel: string } {
  const rad = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const titel = rad(b.titel), omrade = rad(b.omrade);
  const text = String(b.text ?? "").replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!titel) return { ok: false, fel: "Skriv en titel." };
  if (titel.length > TITEL_MAX) return { ok: false, fel: `Titeln får vara högst ${TITEL_MAX} tecken.` };
  if (omrade.length > OMRADE_MAX) return { ok: false, fel: `Området får vara högst ${OMRADE_MAX} tecken.` };
  if (!text) return { ok: false, fel: "Dokumentet har ingen text." };
  if (text.length > TEXT_MAX) return { ok: false, fel: `Dokumentet är för långt: högst ${TEXT_MAX.toLocaleString("sv-SE")} tecken. Dela det i flera.` };
  return { ok: true, falt: { titel, omrade, text } };
}

/** Filens sort ur namnet, eller null för en fil kunskapsbasen inte läser. */
export function filsort(namn: unknown): (typeof FILSORTER)[number] | null {
  const m = /\.[a-z0-9]+$/i.exec(String(namn ?? "").trim());
  const s = m ? m[0].toLowerCase() : "";
  return (FILSORTER as readonly string[]).includes(s) ? (s as (typeof FILSORTER)[number]) : null;
}

/** Titeln en uppladdad fil får: filens namn utan ändelse, med streck som mellanslag. */
export const titelUrFil = (namn: string): string => namn.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TITEL_MAX) || "Dokument";

export type Missrad = { sokord: string; antal: number; senast: string };

/** Listan över det som saknas: samma sökning en gång, den mest frågade först. Stor och liten bokstav är samma sökning. */
export function grupperaMissar(rader: readonly { sokord: string; nar: string }[]): Missrad[] {
  const m = new Map<string, Missrad>();
  for (const r of rader) {
    const k = r.sokord.trim().toLowerCase();
    const f = m.get(k);
    if (f) { f.antal += 1; if (r.nar > f.senast) f.senast = r.nar; } else m.set(k, { sokord: r.sokord.trim(), antal: 1, senast: r.nar });
  }
  return [...m.values()].sort((a, b) => b.antal - a.antal || b.senast.localeCompare(a.senast));
}

/** Vem som sköter kunskapsbasen: den som får ändra företagets inställningar (admin och uppåt). */
export const farSkotaKunskap = (niva: string): boolean => niva === "admin" || niva === "superadmin";
