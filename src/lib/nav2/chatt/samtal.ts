/**
 * Chatten: ett samtal med Claude, från frågan till svaret.
 *
 * Samma slinga körs av rutten (`/nav2/chatt`) och av provet av modellerna
 * (`scripts/chatt-prov.mjs`), så att det provet godkänner är det som körs.
 * Klienten skickas in: filen når aldrig Anthropic själv.
 *
 * Reglerna slingan håller:
 *   - Stoppskälet läses före innehållet. Ett avböjt eller avbrutet svar kör
 *     aldrig sina verktyg.
 *   - Claudes tur läggs tillbaka oförändrad mellan verktygsvarven.
 *   - Systemtexten och verktygslistan är desamma i varje anrop, så att de cachas.
 *   - Varje anrop räknas i kostnaden, också när frågan slutar i ett fel.
 */
import { efterReserv, forsok, hanvisningsfel, kostnadUsd, sattInTal, talfalt, utanMarken, type InsattTal, type Usage } from "./chattforma.ts";
import { EFFORT, OMSKRIV, SYSTEMTEXT } from "./systemtext.ts";
import { VERKTYG, hamtarText, kallrad, korVerktyg, type Ctx, type Utkast } from "./verktyg.ts";

/** Högst så här många anrop till Claude per fråga. */
export const MAX_VARV = 6;
export const MAX_UT = 2000;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Haiku 5.5 har ingen reservmodell på servern. */
export const harReserv = (modell: string) => !modell.startsWith("claude-haiku");
export const KALLRAD_AI = "Skrivet av AI ur Navs tal";

export type Tur = { role: "user" | "assistant"; content: unknown };
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown };
type Meddelande = { stop_reason: string | null; usage: Usage; content: Block[]; model?: string };
/** Det slingan behöver av Anthropics klient. */
export type Klient = { beta: { messages: { stream(p: Record<string, unknown>, o?: { signal?: AbortSignal }): { finalMessage(): Promise<unknown> } } } };

/**
 * Hela frågan får så här lång tid, varv, anrop och verktyg tillsammans. Rutten får arbeta i 120 sekunder
 * (`maxDuration`), och det som blir över går till att skriva den verkliga kostnaden i loggen.
 */
export const FRIST_MS = 100_000;
const BESKED_TID = "Frågan tog för lång tid. Försök med en smalare fråga.";
class Tidsslut extends Error {}

/** Ett löfte som ger upp när tiden är slut. Det som hängde lämnas åt sitt öde; frågan går vidare. */
function medFrist<T>(lofte: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const slut = new Promise<never>((_res, rej) => { t = setTimeout(() => rej(new Tidsslut()), Math.max(0, ms)); });
  return Promise.race([lofte, slut]).finally(() => clearTimeout(t));
}

/**
 * Kostnaden som skrivs i loggen. Avbröts ett anrop vid fristen vet ingen vad det kostade, så raden behåller
 * det reserverade beloppet (det mesta frågan kunde kosta), och aldrig mindre än det som faktiskt mättes.
 */
export const loggKostnadUsd = (r: { kostnadUsd: number; ofullstandig: boolean }, reserverat: number): number =>
  r.ofullstandig ? Math.max(r.kostnadUsd, reserverat) : r.kostnadUsd;

const obelagdaI = (text: string): string[] => [...new Set([...text.matchAll(/⟦obelagt:([^⟧]*)⟧/g)].map((m) => m[1]).filter((t) => t !== "?"))].slice(0, 20);

export type Handelse =
  | { h: "hamtar"; text: string }
  | { h: "svar"; text: string; tal: (InsattTal & { om: string })[]; obelagda: number; kalla: string; utkast: Utkast[] }
  | { h: "avbojt"; text: string }
  | { h: "fel"; text: string };

export type Samtalssvar = {
  stopp: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** I dollar: det Anthropic tar betalt, och det gränserna räknas på. */
  kostnadUsd: number;
  /** Hur många gånger en reservmodell tog över. */
  reserv: number;
  /** Svaret hade tal utan källa och skrevs om en gång (`OMSKRIV`). */
  omskrivet: boolean;
  /** Ett anrop avbröts vid fristen, så kostnaden ovan är inte hela kostnaden. */
  ofullstandig: boolean;
  anrop: { namn: string; input: unknown }[];
  /** Verktygssvaren, i anropens ordning. */
  svar: Record<string, unknown>[];
  /** Claudes egen text, med hänvisningarna (`{{t:1.antal}}`). Provet sparar den, så att rättningen kan göras om. */
  ra: string | null;
  /** Svaret med märken (`⟦t1:12⟧`), eller null när frågan inte fick ett svar. */
  text: string | null;
  /** Svaret utan märken, som det sparas i loggen. */
  ren: string | null;
  tal: InsattTal[];
  obelagda: number;
  utkast: Utkast[];
};

export async function korSamtal(i: { klient: Klient; modell: string; turer: Tur[]; ctx: Ctx; sand: (h: Handelse) => void; fristMs?: number; klocka?: () => number }): Promise<Samtalssvar> {
  const { klient, modell, ctx, sand } = i;
  const klocka = i.klocka ?? Date.now;
  const slut = klocka() + (i.fristMs ?? FRIST_MS);
  const kvar = () => slut - klocka();
  const turer = [...i.turer];
  const ut: Samtalssvar = { stopp: "fel", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, kostnadUsd: 0, reserv: 0, omskrivet: false, ofullstandig: false, anrop: [], svar: [], ra: null, text: null, ren: null, tal: [], obelagda: 0, utkast: [] };
  try {
    for (let varv = 0; ; varv++) {
      if (kvar() <= 0) throw new Tidsslut();
      if (varv >= MAX_VARV) {
        ut.stopp = "for-manga-varv";
        sand({ h: "fel", text: "Frågan tog för många steg. Försök med en smalare fråga." });
        return ut;
      }
      // Anropet avbryts när fristen är slut, också mellan SDK:ns egna omförsök.
      const avbryt = new AbortController();
      const timer = setTimeout(() => avbryt.abort(), Math.max(0, kvar()));
      let m: Meddelande;
      try {
        m = (await klient.beta.messages
          .stream({
            model: modell,
            max_tokens: MAX_UT,
            system: [{ type: "text", text: SYSTEMTEXT, cache_control: { type: "ephemeral" } }],
            tools: VERKTYG,
            tool_choice: { type: "auto" },
            output_config: { effort: EFFORT },
            messages: turer,
            ...(harReserv(modell) ? { fallbacks: "default", betas: [FALLBACK_BETA] } : {}),
          }, { signal: avbryt.signal })
          .finalMessage()) as Meddelande;
      } catch (e) {
        if (avbryt.signal.aborted) {
          ut.ofullstandig = true;
          throw new Tidsslut();
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }

      // Tog en reservmodell över står varje försök för sig, med sin modell och sina token. Alla räknas.
      const svarade = m.model || modell;
      for (const f of forsok(modell, m.usage, svarade)) {
        ut.usage.input_tokens += f.usage.input_tokens ?? 0;
        ut.usage.output_tokens += f.usage.output_tokens ?? 0;
        ut.usage.cache_read_input_tokens += f.usage.cache_read_input_tokens ?? 0;
        ut.usage.cache_creation_input_tokens += f.usage.cache_creation_input_tokens ?? 0;
        if (f.reserv) ut.reserv++;
      }
      ut.kostnadUsd += kostnadUsd(modell, m.usage, svarade);
      ut.stopp = m.stop_reason ?? "okant";
      // Efter ett byte skickas bara det tillbaka som Anthropic tar emot, och bara verktygen efter bytet körs.
      const innehall = efterReserv(m.content);

      if (ut.stopp === "refusal") {
        sand({ h: "avbojt", text: "Modellen avböjde att svara på det här. Jag svarar som sökrutan i stället." });
        return ut;
      }
      if (ut.stopp === "tool_use" || ut.stopp === "pause_turn") {
        turer.push({ role: "assistant", content: innehall });
        if (ut.stopp === "pause_turn") continue;
        const resultat: unknown[] = [];
        for (const block of innehall) {
          if (block.type !== "tool_use") continue;
          const namn = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          ut.anrop.push({ namn, input });
          sand({ h: "hamtar", text: hamtarText(namn, input) });
          const r = await medFrist(korVerktyg(namn, input, ctx, ut.anrop.length), kvar());
          ut.svar.push(r.svar);
          if (r.utkast) ut.utkast = r.utkast;
          resultat.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(r.svar) });
        }
        turer.push({ role: "user", content: resultat });
        continue;
      }
      if (ut.stopp !== "end_turn") {
        sand({ h: "fel", text: ut.stopp === "max_tokens" ? "Svaret blev för långt och bröts. Försök med en smalare fråga." : "Jag fick inget helt svar. Försök igen." });
        return ut;
      }
      const text = innehall.flatMap((x) => (x.type === "text" && x.text ? [x.text] : [])).join("\n").trim();
      if (!text) {
        sand({ h: "fel", text: "Jag fick inget svar. Försök igen." });
        return ut;
      }
      const insatt = sattInTal(text, ut.svar);
      // Ett tal utan källa: Claude får skriva om svaret en gång, om det finns ett varv kvar. Personen ser bara det sista.
      if (insatt.obelagda > 0 && !ut.omskrivet && varv + 1 < MAX_VARV) {
        ut.omskrivet = true;
        turer.push({ role: "assistant", content: innehall });
        turer.push({ role: "user", content: OMSKRIV(obelagdaI(insatt.text), hanvisningsfel(text, ut.svar).slice(0, 10), talfalt(ut.svar)) });
        sand({ h: "hamtar", text: "Kontrollerar talen i svaret." });
        continue;
      }
      ut.ra = text;
      ut.text = insatt.text;
      ut.ren = utanMarken(insatt.text);
      ut.tal = insatt.tal;
      ut.obelagda = insatt.obelagda;
      sand({ h: "svar", text: insatt.text, tal: insatt.tal.map((t) => ({ ...t, om: kallrad(ut.svar[t.kalla.anrop - 1], t.kalla.falt) })), obelagda: insatt.obelagda, kalla: KALLRAD_AI, utkast: ut.utkast });
      return ut;
    }
  } catch (e) {
    if (e instanceof Tidsslut) {
      ut.stopp = "for-lang-tid";
      sand({ h: "fel", text: BESKED_TID });
      return ut;
    }
    ut.stopp = "fel";
    console.error(`chatt: ${e instanceof Error ? e.message : String(e)}`);
    sand({ h: "fel", text: "Chatten svarar inte just nu. Jag svarar som sökrutan i stället." });
    return ut;
  }
}

const VECKODAG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
/** Användarens tur: allt som varierar står här, aldrig i systemtexten. */
export const fragetur = (x: { idag: string; klocka: string; fornamn: string; roller: readonly string[]; fraga: string }): string =>
  `Idag är ${x.idag} (${VECKODAG[new Date(`${x.idag}T12:00:00Z`).getUTCDay()]}), klockan ${x.klocka}. Jag heter ${x.fornamn}. Mina roller i Nav: ${x.roller.join(", ") || "inga"}.\n\n${x.fraga}`;
