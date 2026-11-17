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
 *   - fraga_tillbaka avslutar frågan med ett val, utan ett nytt anrop. Inget kort förbereds i samma varv (B2).
 */
import { UTKAST_MS, efterReserv, sammaModell, forsok, hanvisningsfel, historiaRad, jaFraga, kostnadUsd, nastaFragor, omRad, sattInTal, slappUtkast, talfalt, underlagUr, utanMarken, utanTal, valUr, type InsattTal, type Nasta, type Underlag, type Usage, type Val } from "./chattforma.ts";
import { EFFORT, OMSKRIV, SYSTEMTEXT } from "./systemtext.ts";
import { FRAGA_TILLBAKA, VERKTYG, VERKTYGSFEL, hamtarText, kallaFor, kallaTillagg, kallrad, korVerktyg, type Ctx, type Handlingskort, type KallaTillagg, type Verktygssvar } from "./verktyg.ts";

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
/**
 * Det slingan behöver av Anthropics klient. `on("streamEvent")` ger meddelandet så långt det kommit, för utkastet;
 * en klient utan `on` (provets attrapper) får svaret i ett stycke, som förut. Anropet är detsamma i båda fallen.
 */
export type Strom = { finalMessage(): Promise<unknown>; on?(handelse: "streamEvent", lyssnare: (h: unknown, sahittills: unknown) => void): unknown };
export type Klient = { beta: { messages: { stream(p: Record<string, unknown>, o?: { signal?: AbortSignal }): Strom } } };

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
/** Felraden lovar bara det rutan gör (N4): Sök i stället kräver ett klick, så det står som ett val, inte som ett löfte. */
export const BESKED_AI = "Chatten svarar inte just nu. Sök i stället ger svar ur Navs sökruta.";
const BESKED_AVBOJT = "Modellen avböjde att svara på det här. Sök i stället ger svar ur Navs sökruta.";

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
 * Ett tal som klienten får det: med källraden (`om`) och det som står under den efter klicket (`ser`, `motvikt`,
 * `forFa`, ur `kallaTillagg`). Samma form i utkastet och i svaret. Inget av det går till Claude eller in i texten.
 */
export type TalUt = InsattTal & { om: string } & KallaTillagg;
/**
 * Ett kort som klienten får det, med numret på anropet som förberedde det: utfallet skrivs mot det numret. `verktyg` och
 * `input` är verktyget och dess input, så att personen kan rätta kortet före Godkänn (funktion 6: `{kommando}` i rutten
 * bygger om det). De står bara i händelsen till webbläsaren, aldrig i det Claude får.
 */
export type KortUt = Handlingskort & { anrop: number; verktyg: string; input: Record<string, unknown> };
/** En källa under svaret som går att öppna: verktyget säger vilken vy. */
export type KallaUt = { verktyg: string; anrop: number; text: string };
/** Millisekunder: varje anrop till Claude och varje verktygsvarv, tiden till första utkastet och hela samtalet. */
export type Tider = { ai: number[]; verktyg: number[]; forstaText: number | null; totalt: number };

/**
 * Strömmens händelser. `hamtar`, `klart` och `text` kommer medan frågan arbetar; `svar`, `avbojt` och `fel` avslutar den, och
 * efter en av dem kommer inget mer. `anrop` är verktygsanropets nummer i frågan: `klart` hör till `hamtar` med samma nummer.
 * `rad` skickas av rutten, före allt annat. Hela kontraktet för klienten: .lyft/chatt-server-api.md.
 */
export type Handelse =
  | { h: "rad"; id: string }
  | { h: "hamtar"; text: string; anrop?: number; verktyg?: string }
  | { h: "klart"; anrop: number; ok: boolean; text: string; ms: number }
  | { h: "text"; text: string; tal: TalUt[] }
  | { h: "svar"; text: string; tal: TalUt[]; obelagda: number; kalla: string; kallor: KallaUt[]; kort: KortUt[]; nasta: Nasta[]; ja: boolean; underlag?: Underlag & { rubrik: string }; val?: Val; varv: number; tider: Tider }
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
  /**
   * Verktygsanropen i ordning. `ok` är falskt när verktyget svarade med ett fel; `ms` är hur länge det tog. `kort` är
   * sant bara på det förbered-anrop vars kort visades i svaret (inte en dubblett, inte ett kort över KORT_MAX): bara
   * där tar loggen emot ett utfall (`medUtfall`). Det står i loggens `verktyg`, aldrig i det Claude får. Ett anrop som
   * aldrig kördes (fraga_tillbaka, och ett förbered-anrop i samma steg som den) har varken `ok` eller `ms`. `alternativ`
   * står bara på fraga_tillbaka: knapparna som visades efter att de obelagda strukits (B2), också när de var för få.
   */
  anrop: { namn: string; input: unknown; ok?: boolean; ms?: number; kort?: true; alternativ?: string[] }[];
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
  kort: KortUt[];
  /** Valet när frågan slutade med fraga_tillbaka och minst två alternativ stod kvar (B2), annars null. */
  val: Val | null;
  /** Antal anrop till Claude. */
  varv: number;
  tider: Tider;
};

/**
 * `avbruten`: personen har slutat lyssna (stängt fliken eller tryckt Stopp). Anropet som pågår får bli klart, så att
 * kostnaden blir känd, men inget nytt anrop och inga fler verktyg körs. `verktygMs` finns för provet.
 */
export async function korSamtal(i: { klient: Klient; modell: string; turer: Tur[]; ctx: Ctx; sand: (h: Handelse) => void; fristMs?: number; verktygMs?: number; klocka?: () => number; avbruten?: AbortSignal; fraga?: string }): Promise<Samtalssvar> {
  const { klient, modell, ctx } = i;
  // Efter svaret, avböjandet eller felet kommer inget mer, inte heller från ett verktyg som blev klart för sent.
  let avslutad = false;
  const sand = (h: Handelse) => {
    if (avslutad) return;
    // Ett utkast står aldrig kvar ovanför ett fel eller ett avböjande: det dras tillbaka först (`svar` ersätter det själv).
    if (h.h === "avbojt" || h.h === "fel") dragTillbaka();
    if (h.h === "svar" || h.h === "avbojt" || h.h === "fel") avslutad = true;
    i.sand(h);
  };
  const klocka = i.klocka ?? Date.now;
  const borjan = klocka();
  const slut = klocka() + (i.fristMs ?? FRIST_MS);
  const kvar = () => slut - klocka();
  const verktygMs = i.verktygMs ?? VERKTYG_MS;
  const turer = [...i.turer];
  const ut: Samtalssvar = { stopp: "fel", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, kostnadUsd: 0, reserv: 0, omskrivet: false, ofullstandig: false, anrop: [], svar: [], ra: null, text: null, ren: null, tal: [], obelagda: 0, kort: [], val: null, varv: 0, tider: { ai: [], verktyg: [], forstaText: null, totalt: 0 } };
  const talUt = (tal: InsattTal[]): TalUt[] => tal.map((t) => ({ ...t, om: kallrad(ut.svar[t.kalla.anrop - 1], t.kalla.falt), ...kallaTillagg(ut.svar[t.kalla.anrop - 1], t.kalla.falt) }));

  // UTKASTET: svaret visas mening för mening medan det skrivs, med talen insatta som i slutsvaret. En mening släpps
  // först när den är hel och inte har ett tal utan källa eller en halv hänvisning (`slappUtkast`). `visat` är sant när
  // något syns och inte har dragits tillbaka. Personen som slutat lyssna får ingenting.
  let visat = false;
  let sistText = -Infinity;
  function dragTillbaka() {
    if (!visat || avslutad) return;
    visat = false;
    if (!i.avbruten?.aborted) i.sand({ h: "text", text: "", tal: [] });
  }
  /** En lyssnare för ett varv. Den räknar aldrig kostnad och kan aldrig fälla svaret: allt den gör är att visa. */
  const utkastLyssnare = () => {
    let tyst = false;
    let provat = 0;
    const pa = (_h: unknown, sahittills: unknown) => {
      if (tyst || avslutad) return;
      try {
        const snap = sahittills as { content?: unknown; model?: unknown } | null;
        const innehall = snap?.content;
        if (!Array.isArray(innehall)) return;
        // En reservmodell tar över (ett byte i strömmen, eller en annan modell från början), eller varvet slutar i ett
        // verktyg: det som visats var inte svaret.
        const annanModell = typeof snap?.model === "string" && !!snap.model && !sammaModell(snap.model, modell);
        if (annanModell || innehall.some((b) => (b as Block | null)?.type === "fallback" || (b as Block | null)?.type === "tool_use")) {
          tyst = true;
          dragTillbaka();
          return;
        }
        if (i.avbruten?.aborted) return;
        if (klocka() - sistText < UTKAST_MS) return;
        // Samma text som slutsvaret byggs av: textblocken i ordning, med radbrytning emellan.
        const text = (innehall as Block[]).flatMap((x) => (x?.type === "text" && x.text ? [x.text] : [])).join("\n").trimStart();
        const s = slappUtkast(text, ut.svar, provat);
        provat = s.provat;
        const u = s.utkast;
        if (!u) return;
        sistText = klocka();
        visat = true;
        if (ut.tider.forstaText === null) ut.tider.forstaText = Math.max(0, sistText - borjan);
        sand({ h: "text", text: u.text, tal: talUt(u.tal) });
      } catch (e) {
        tyst = true;
        console.error(`chatt: utkastet visades inte: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    return { pa, stang: () => { tyst = true; } };
  };

  /**
   * Slutsvaret, för ett svar och för en fråga tillbaka (B2): texten med talen, källorna, underlaget och händelsen `svar`.
   * `val` finns bara när frågan slutade med fraga_tillbaka och minst två alternativ stod kvar.
   */
  const slutsvar = (ra: string, insatt: { text: string; tal: InsattTal[]; obelagda: number }, o: { nasta: Nasta[]; ja: boolean; val: Val | null }) => {
    ut.ra = ra;
    ut.text = insatt.text;
    ut.ren = utanMarken(insatt.text);
    ut.tal = insatt.tal;
    ut.obelagda = insatt.obelagda;
    ut.val = o.val;
    // Varje läsning som svarade blir en källa som går att öppna. Korten är inga källor.
    const kallor: KallaUt[] = [];
    ut.anrop.forEach((a, n) => {
      const s = ut.svar[n];
      if (a.ok !== true || !s || typeof s.fel === "string" || s._egnaOrd === true || a.namn.startsWith("forbered_") || kallor.some((k) => k.verktyg === a.namn)) return;
      kallor.push({ verktyg: a.namn, anrop: n + 1, text: kallrad(s) });
    });
    // Underlaget får rubriken ur verktygets egen källrad, samma text som under talet.
    const rader = underlagUr(ut.svar, insatt.tal);
    const underlag = rader ? { ...rader, rubrik: kallrad(ut.svar[rader.anrop - 1]) } : null;
    ut.varv = ut.tider.ai.length;
    ut.tider.totalt = Math.max(0, klocka() - borjan);
    sand({
      h: "svar", text: insatt.text, tal: talUt(insatt.tal), obelagda: insatt.obelagda, kalla: kallaFor(ut.svar), kallor, kort: ut.kort,
      nasta: o.nasta, ja: o.ja, ...(underlag ? { underlag } : {}), ...(o.val ? { val: o.val } : {}), varv: ut.varv, tider: { ...ut.tider, ai: [...ut.tider.ai], verktyg: [...ut.tider.verktyg] },
    });
  };

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
      // Varvet före första verktygssvaret visas inte medan det skrivs: dess text är nästan alltid inledningen till ett verktyg.
      const lyssnare = ut.anrop.length > 0 ? utkastLyssnare() : null;
      const aiStart = klocka();
      let m: Meddelande;
      try {
        const strom = klient.beta.messages
          .stream({
            model: modell,
            max_tokens: MAX_UT,
            system: [{ type: "text", text: SYSTEMTEXT, cache_control: { type: "ephemeral" } }],
            tools: VERKTYG,
            tool_choice: { type: "auto" },
            output_config: { effort: EFFORT },
            messages: turer,
            ...(harReserv(modell) ? { fallbacks: "default", betas: [FALLBACK_BETA] } : {}),
          }, { signal: avbryt.signal });
        if (lyssnare && typeof strom.on === "function") {
          try {
            strom.on("streamEvent", lyssnare.pa);
          } catch {
            // Utan lyssnare kommer svaret i ett stycke, som förut.
          }
        }
        m = (await strom.finalMessage()) as Meddelande;
      } catch (e) {
        if (avbryt.signal.aborted) {
          ut.ofullstandig = true;
          throw new Tidsslut();
        }
        throw e;
      } finally {
        clearTimeout(timer);
        lyssnare?.stang();
        ut.tider.ai.push(Math.max(0, klocka() - aiStart));
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
      if (innehall !== m.content || !sammaModell(svarade, modell)) dragTillbaka();

      if (ut.stopp === "refusal") {
        dragTillbaka();
        sand({ h: "avbojt", text: BESKED_AVBOJT });
        return ut;
      }
      if (ut.stopp === "tool_use" || ut.stopp === "pause_turn") {
        dragTillbaka();
        turer.push({ role: "assistant", content: innehall });
        if (ut.stopp === "pause_turn") continue;
        if (stoppad()) return ut;
        // Numren delas ut i Claudes ordning innan något körs, så att `{{t:N.fält}}` pekar dit den gjorde. Verktygen körs
        // samtidigt (källorna läses en gång per fråga, så två verktyg på samma källa läser den en gång), och svaren läggs
        // tillbaka i Claudes ordning: Claude ser exakt det den hade sett om de körts ett i taget.
        // FRÅGA TILLBAKA (B2): finns fraga_tillbaka i steget körs läsningarna och loggas, men inget förbered-anrop i samma
        // steg (inget kort före valet), och frågan slutar med valet utan ett nytt anrop till Claude. Det som inte körs
        // får ingen rad hos personen (`hamtar`), men sin plats i listan, så att numren stämmer.
        const fragar = innehall.some((b) => b.type === "tool_use" && b.name === FRAGA_TILLBAKA);
        const verktygStart = klocka();
        const jobb = innehall.flatMap((block) => {
          if (block.type !== "tool_use") return [];
          const namn = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          ut.anrop.push({ namn, input });
          const nr = ut.anrop.length;
          if (namn === FRAGA_TILLBAKA) return [{ id: block.id, namn, input, nr, r: korVerktyg(namn, input, ctx, nr) }];
          if (fragar && namn.startsWith("forbered_")) return [{ id: block.id, namn, input, nr, r: Promise.resolve<Verktygssvar>({ svar: { _verktyg: namn, _anrop: nr, fel: "Förbereddes inte: personen väljer först." } }) }];
          sand({ h: "hamtar", text: hamtarText(namn, input), anrop: nr, verktyg: namn });
          return [{ id: block.id, namn, input, nr, r: ettVerktyg(namn, input, nr) }];
        });
        const klara = await Promise.all(jobb.map((j) => j.r));
        ut.tider.verktyg.push(Math.max(0, klocka() - verktygStart));
        const resultat: unknown[] = [];
        jobb.forEach((j, n) => {
          const r = klara[n];
          let svar = r.svar;
          // Samma kort en gång till visas inte två gånger. Ryms kortet inte får Claude veta det: den får aldrig säga att
          // något väntar på Godkänn som personen inte ser.
          const steg = r.kort ? JSON.stringify(r.kort.steg) : "";
          if (r.kort && !ut.kort.some((k) => JSON.stringify(k.steg) === steg)) {
            if (ut.kort.length < KORT_MAX) {
              ut.kort.push({ ...r.kort, anrop: j.nr, verktyg: j.namn, input: j.input });
              ut.anrop[j.nr - 1].kort = true;
            } else svar = { _verktyg: j.namn, _anrop: j.nr, fel: "Svaret har redan så många kort som ryms, så det här kortet visas inte. Be personen godkänna de som visas och fråga sedan igen." };
          }
          ut.svar.push(svar);
          resultat.push({ type: "tool_result", tool_use_id: j.id, content: JSON.stringify(svar) });
        });
        const tillbaka = jobb.find((j) => j.namn === FRAGA_TILLBAKA);
        if (tillbaka) {
          // Ett stopp medan läsningarna kördes är ett stopp mellan två varv, som i en vanlig fråga: inget val visas.
          if (stoppad()) return ut;
          // Knapparna bara ur den här frågans kandidater eller personens egen fråga, utan obelagda tal (`valUr`).
          const v = valUr(tillbaka.input, ut.svar, i.fraga ?? "");
          ut.anrop[tillbaka.nr - 1].alternativ = v.alternativ;
          if (!v.fraga) {
            sand({ h: "fel", text: "Jag fick inget svar. Försök igen.", kod: "tomt" });
            return ut;
          }
          ut.stopp = FRAGA_TILLBAKA;
          // Claudes egen text i samma steg står före frågan: den kan vara själva svaret, och frågan gäller det som kommer
          // sedan. Talen sätts in som i ett svar, och inget skrivs om. Står frågan redan sist i texten upprepas den inte.
          const egen = innehall.flatMap((x) => (x.type === "text" && x.text ? [x.text] : [])).join("\n").trim();
          const ra = !egen ? v.fraga : egen.replace(/\s+/g, " ").endsWith(v.fraga) ? egen : `${egen}\n${v.fraga}`;
          const insatt = sattInTal(ra, ut.svar);
          const val = v.alternativ.length >= 2 ? { fraga: utanMarken(sattInTal(v.fraga, ut.svar).text), alternativ: v.alternativ } : null;
          // Utan knappar är det en vanlig fråga: slutar den med "Ska jag …?" får personen Ja-knappen, som efter ett svar.
          slutsvar(ra, insatt, { nasta: [], ja: val ? false : jaFraga(insatt.text, ut.kort.length), val });
          return ut;
        }
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
      // Utkastet dras inte tillbaka här (planen A1-1): det står kvar, nedtonat av klienten under "Kontrollerar talen i
      // svaret.", tills nästa utkast eller `svar` ersätter det. Varje mening i det hade redan sina källor, och personen
      // kan ha läst den. Tar en reservmodell över, slutar omskrivningen i ett verktyg eller faller den, dras det tillbaka då.
      if (insatt.obelagda > 0 && !ut.omskrivet && varv + 1 < MAX_VARV) {
        ut.omskrivet = true;
        turer.push({ role: "assistant", content: innehall });
        turer.push({ role: "user", content: OMSKRIV(obelagdaI(insatt.text), hanvisningsfel(text, ut.svar).slice(0, 10), talfalt(ut.svar)) });
        sand({ h: "hamtar", text: "Kontrollerar talen i svaret." });
        continue;
      }
      // Följdfrågorna byggs av regler ur verktygen som svarade. Kretsen är redan läst av samma verktyg (en gång per fråga).
      let nasta: Nasta[] = [];
      try {
        const k = ut.anrop.some((a) => a.ok === true && (a.namn === "las_matt" || a.namn === "las_affarer")) ? await ctx.kallor.krets() : undefined;
        nasta = nastaFragor({ anrop: ut.anrop, fraga: i.fraga ?? "", idag: ctx.idag, laget: k === null || (Array.isArray(k) && k.some((id) => id !== ctx.mig)) });
      } catch {
        nasta = [];
      }
      slutsvar(text, insatt, { nasta, ja: jaFraga(insatt.text, ut.kort.length), val: null });
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
  } finally {
    ut.varv = ut.tider.ai.length;
    ut.tider.totalt = Math.max(0, klocka() - borjan);
  }
}

/** Högst så här många tidigare utbyten följer med en fråga. */
export const HISTORIA_MAX = 3;
/**
 * Historiken till Claude (A2-3): de tidigare utbytena som turer före frågan. Rutten och provet bygger den med just den
 * här funktionen, så att det provet godkänner är det som körs (samma slinga, överst). Bara poster där både frågan och
 * svaret är icke-tomma texter, de HISTORIA_MAX sista. Frågan klipps vid 1000 tecken och svaret vid 2000. Svarets tal
 * byts mot "[tal]" (`utanTal`): ett tal ur en tidigare tur får aldrig återanvändas utan källa, men datum, klockslag och
 * veckonummer står kvar (A2-1). Efter svaret, utanför klippningen, står vad som hämtades och vad som hände med korten
 * (`historiaRad`, A2-2), som data i svarets egen tur och aldrig i frågans. Inget annat i posten följer med, varken
 * underlag eller kortens innehåll.
 */
export function historiaTurer(historia: unknown): Tur[] {
  const poster = (Array.isArray(historia) ? (historia as unknown[]) : [])
    .filter((h): h is { fraga: string; svar: string; hamtat?: unknown; kortUtfall?: unknown } => !!h && typeof h === "object" && typeof (h as { fraga?: unknown }).fraga === "string" && typeof (h as { svar?: unknown }).svar === "string" && !!(h as { fraga: string }).fraga.trim() && !!(h as { svar: string }).svar.trim())
    .slice(-HISTORIA_MAX);
  return poster.flatMap((h): Tur[] => {
    const rad = historiaRad(h.hamtat, h.kortUtfall);
    return [
      { role: "user", content: h.fraga.slice(0, 1000) },
      { role: "assistant", content: `${utanTal(h.svar).slice(0, 2000)}${rad ? `\n\n${rad}` : ""}` },
    ];
  });
}

const VECKODAG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
/**
 * Användarens tur: allt som varierar står här, aldrig i systemtexten. Gäller frågan något personen tittar på (`om`, O)
 * står det i en fast form på raden före frågan (`omRad`), som data. Utan `om` är turen exakt som förut. Rutten och
 * provet bygger turen här, så att formen är densamma.
 */
export const fragetur = (x: { idag: string; klocka: string; fornamn: string; roller: readonly string[]; fraga: string; om?: unknown }): string => {
  const om = omRad(x.om);
  return `Idag är ${x.idag} (${VECKODAG[new Date(`${x.idag}T12:00:00Z`).getUTCDay()]}), klockan ${x.klocka}. Jag heter ${x.fornamn}. Mina roller i Nav: ${x.roller.join(", ") || "inga"}.\n\n${om ? `${om}\n` : ""}${x.fraga}`;
};
