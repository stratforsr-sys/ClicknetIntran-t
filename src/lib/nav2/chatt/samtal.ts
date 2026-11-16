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
 *   - Verktygen i ett varv körs samtidigt, men svaren läggs tillbaka i Claudes ordning.
 */
import { efterReserv, forsok, hanvisningsfel, kostnadUsd, sattInTal, talfalt, utanMarken, type InsattTal, type Usage } from "./chattforma.ts";
import { EFFORT, OMSKRIV, SYSTEMTEXT } from "./systemtext.ts";
import { VERKTYG, VERKTYGSFEL, hamtarText, kallaFor, kallrad, korVerktyg, type Ctx, type Handlingskort, type Verktygssvar } from "./verktyg.ts";

/** Högst så här många anrop till Claude per fråga. */
export const MAX_VARV = 6;
export const MAX_UT = 2000;
/** Högst så här många kort att godkänna i ett svar. */
export const KORT_MAX = 3;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Haiku 5.5 har ingen reservmodell på servern. */
export const harReserv = (modell: string) => !modell.startsWith("claude-haiku");

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
/**
 * Ett verktyg får så här lång tid. Verktygen i ett varv körs samtidigt, så ett som hänger håller inte upp de andra,
 * och efter fristen svarar det med samma fel som när det inte gick att läsa: Claude får säga vad som saknas.
 */
export const VERKTYG_MS = 15_000;
const BESKED_TID = "Frågan tog för lång tid. Försök med en smalare fråga.";
class Tidsslut extends Error {}

/** Varför frågan inte fick ett svar, för klienten. Texten är det personen läser; koden är det klienten kan välja på. */
export type Felkod = "tillfalligt" | "fil" | "for-stor" | "ai" | "tid" | "steg" | "langt" | "ofullstandigt" | "tomt" | "avbruten";
const BESKED_AI = "Chatten svarar inte just nu. Jag svarar som sökrutan i stället.";

/**
 * Ett fel från Anthropic, sorterat till ett besked personen kan göra något med. `status` är svarets HTTP-status, och
 * saknas den nådde frågan kanske Anthropic och kostade något som aldrig mättes (nätet föll, eller klientens tidsgräns).
 */
export function felFranAi(e: unknown, medBilagor: boolean): { kod: Felkod; text: string; status: number | null } {
  const x = (e ?? {}) as { status?: unknown; name?: unknown; message?: unknown };
  const status = typeof x.status === "number" && Number.isFinite(x.status) ? x.status : null;
  const text = typeof x.message === "string" ? x.message : "";
  if (status === 413 || (status === 400 && /too long|too large|context (?:window|length)/i.test(text))) {
    return { kod: "for-stor", text: "Frågan blev för stor för chatten. Försök med en mindre fil eller en smalare fråga.", status };
  }
  if (status === 400 && medBilagor) return { kod: "fil", text: "Filen gick inte att läsa. Försök med en annan fil, eller fråga utan den.", status };
  if (status === 429 || status === 529 || (status !== null && status >= 500) || (status === null && /Connection|Timeout/.test(String(x.name ?? "")))) {
    return { kod: "tillfalligt", text: "Chatten är tillfälligt upptagen. Försök igen om en stund.", status };
  }
  return { kod: "ai", text: BESKED_AI, status };
}

/** Bär frågans tur en bild eller en PDF? Ett 400-svar gäller då nästan alltid filen. */
const harBilagor = (turer: readonly Tur[]): boolean =>
  turer.some((t) => t.role === "user" && Array.isArray(t.content) && t.content.some((b) => !!b && typeof b === "object" && ["image", "document"].includes(String((b as { type?: unknown }).type))));

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

/**
 * Strömmens händelser. `hamtar` och `klart` kommer medan frågan arbetar; `svar`, `avbojt` och `fel` avslutar den, och
 * efter en av dem kommer inget mer. `anrop` är verktygsanropets nummer i frågan: `klart` hör till `hamtar` med samma nummer.
 */
export type Handelse =
  | { h: "hamtar"; text: string; anrop?: number; verktyg?: string }
  | { h: "klart"; anrop: number; ok: boolean; text: string; ms: number }
  | { h: "svar"; text: string; tal: (InsattTal & { om: string })[]; obelagda: number; kalla: string; kort: Handlingskort[] }
  | { h: "avbojt"; text: string }
  | { h: "fel"; text: string; kod: Felkod };

export type Samtalssvar = {
  stopp: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  /** I dollar: det Anthropic tar betalt, och det gränserna räknas på. */
  kostnadUsd: number;
  /** Hur många gånger en reservmodell tog över. */
  reserv: number;
  /** Svaret hade tal utan källa och skrevs om en gång (`OMSKRIV`). */
  omskrivet: boolean;
  /** Ett anrop avbröts vid fristen eller föll utan svar, så kostnaden ovan är inte hela kostnaden. */
  ofullstandig: boolean;
  /** Verktygsanropen i ordning. `ok` är falskt när verktyget svarade med ett fel; `ms` är hur länge det tog. */
  anrop: { namn: string; input: unknown; ok?: boolean; ms?: number }[];
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
  /** Korten Claude har förberett, i den ordning de kom. Inget av dem är utfört: personen godkänner vart och ett. */
  kort: Handlingskort[];
};

/**
 * `avbruten`: personen har slutat lyssna (stängt fliken eller tryckt Stopp). Anropet som pågår får bli klart, så att
 * kostnaden blir känd, men inget nytt anrop och inga fler verktyg körs. `verktygMs` finns för provet.
 */
export async function korSamtal(i: { klient: Klient; modell: string; turer: Tur[]; ctx: Ctx; sand: (h: Handelse) => void; fristMs?: number; verktygMs?: number; klocka?: () => number; avbruten?: AbortSignal }): Promise<Samtalssvar> {
  const { klient, modell, ctx } = i;
  // Efter svaret, avböjandet eller felet kommer inget mer, inte heller från ett verktyg som blev klart för sent.
  let avslutad = false;
  const sand = (h: Handelse) => {
    if (avslutad) return;
    if (h.h === "svar" || h.h === "avbojt" || h.h === "fel") avslutad = true;
    i.sand(h);
  };
  const klocka = i.klocka ?? Date.now;
  const slut = klocka() + (i.fristMs ?? FRIST_MS);
  const kvar = () => slut - klocka();
  const verktygMs = i.verktygMs ?? VERKTYG_MS;
  const turer = [...i.turer];
  const ut: Samtalssvar = { stopp: "fel", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, kostnadUsd: 0, reserv: 0, omskrivet: false, ofullstandig: false, anrop: [], svar: [], ra: null, text: null, ren: null, tal: [], obelagda: 0, kort: [] };
  const stoppad = (): boolean => {
    if (!i.avbruten?.aborted) return false;
    ut.stopp = "avbruten";
    sand({ h: "fel", text: "Frågan stoppades.", kod: "avbruten" });
    return true;
  };

  /** Ett verktyg, med sin egen frist. Är det hela frågans frist som tar slut gäller den, som förut. */
  const ettVerktyg = async (namn: string, input: Record<string, unknown>, nr: number): Promise<Verktygssvar> => {
    const start = klocka();
    const egen = verktygMs < kvar();
    let r: Verktygssvar;
    try {
      r = await medFrist(korVerktyg(namn, input, ctx, nr), egen ? verktygMs : kvar());
    } catch (e) {
      if (!(e instanceof Tidsslut) || !egen) throw e;
      console.error(`chatt: verktyget ${namn} svarade inte på ${verktygMs} ms`);
      r = { svar: { _verktyg: namn, _anrop: nr, fel: VERKTYGSFEL } };
    }
    const ok = typeof r.svar.fel !== "string";
    const ms = Math.max(0, klocka() - start);
    Object.assign(ut.anrop[nr - 1], { ok, ms });
    // Verktygens egna fel är skrivna till Claude ("Fråga vilket bolag det gäller."), så personen får en egen rad.
    sand({ h: "klart", anrop: nr, ok, text: ok ? kallrad(r.svar) : r.svar.fel === VERKTYGSFEL ? VERKTYGSFEL : "Gav inget svar att använda.", ms });
    return r;
  };

  try {
    for (let varv = 0; ; varv++) {
      if (stoppad()) return ut;
      if (kvar() <= 0) throw new Tidsslut();
      if (varv >= MAX_VARV) {
        ut.stopp = "for-manga-varv";
        sand({ h: "fel", text: "Frågan tog för många steg. Försök med en smalare fråga.", kod: "steg" });
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
        if (stoppad()) return ut;
        // Numren delas ut i Claudes ordning innan något körs, så att `{{t:N.fält}}` pekar dit den gjorde. Verktygen körs
        // samtidigt (källorna läses en gång per fråga, så två verktyg på samma källa läser den en gång), och svaren läggs
        // tillbaka i Claudes ordning: Claude ser exakt det den hade sett om de körts ett i taget.
        const jobb = innehall.flatMap((block) => {
          if (block.type !== "tool_use") return [];
          const namn = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          ut.anrop.push({ namn, input });
          const nr = ut.anrop.length;
          sand({ h: "hamtar", text: hamtarText(namn, input), anrop: nr, verktyg: namn });
          return [{ id: block.id, namn, nr, r: ettVerktyg(namn, input, nr) }];
        });
        const klara = await Promise.all(jobb.map((j) => j.r));
        const resultat: unknown[] = [];
        jobb.forEach((j, n) => {
          const r = klara[n];
          let svar = r.svar;
          // Samma kort en gång till visas inte två gånger. Ryms kortet inte får Claude veta det: den får aldrig säga att
          // något väntar på Godkänn som personen inte ser.
          const steg = r.kort ? JSON.stringify(r.kort.steg) : "";
          if (r.kort && !ut.kort.some((k) => JSON.stringify(k.steg) === steg)) {
            if (ut.kort.length < KORT_MAX) ut.kort.push(r.kort);
            else svar = { _verktyg: j.namn, _anrop: j.nr, fel: "Svaret har redan så många kort som ryms, så det här kortet visas inte. Be personen godkänna de som visas och fråga sedan igen." };
          }
          ut.svar.push(svar);
          resultat.push({ type: "tool_result", tool_use_id: j.id, content: JSON.stringify(svar) });
        });
        turer.push({ role: "user", content: resultat });
        continue;
      }
      if (ut.stopp !== "end_turn") {
        const langt = ut.stopp === "max_tokens";
        sand({ h: "fel", text: langt ? "Svaret blev för långt och bröts. Försök med en smalare fråga." : "Jag fick inget helt svar. Försök igen.", kod: langt ? "langt" : "ofullstandigt" });
        return ut;
      }
      const text = innehall.flatMap((x) => (x.type === "text" && x.text ? [x.text] : [])).join("\n").trim();
      if (!text) {
        sand({ h: "fel", text: "Jag fick inget svar. Försök igen.", kod: "tomt" });
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
      sand({ h: "svar", text: insatt.text, tal: insatt.tal.map((t) => ({ ...t, om: kallrad(ut.svar[t.kalla.anrop - 1], t.kalla.falt) })), obelagda: insatt.obelagda, kalla: kallaFor(ut.svar), kort: ut.kort });
      return ut;
    }
  } catch (e) {
    if (e instanceof Tidsslut) {
      ut.stopp = "for-lang-tid";
      sand({ h: "fel", text: BESKED_TID, kod: "tid" });
      return ut;
    }
    const f = felFranAi(e, harBilagor(i.turer));
    // Utan HTTP-status vet ingen om Anthropic hann ta betalt: loggen behåller då det reserverade beloppet.
    if (f.status === null) ut.ofullstandig = true;
    ut.stopp = f.status === null ? "fel" : `fel:${f.status}`;
    console.error(`chatt: ${e instanceof Error ? e.message : String(e)}`);
    sand({ h: "fel", text: f.text, kod: f.kod });
    return ut;
  }
}

const VECKODAG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
/** Användarens tur: allt som varierar står här, aldrig i systemtexten. */
export const fragetur = (x: { idag: string; klocka: string; fornamn: string; roller: readonly string[]; fraga: string }): string =>
  `Idag är ${x.idag} (${VECKODAG[new Date(`${x.idag}T12:00:00Z`).getUTCDay()]}), klockan ${x.klocka}. Jag heter ${x.fornamn}. Mina roller i Nav: ${x.roller.join(", ") || "inga"}.\n\n${x.fraga}`;
