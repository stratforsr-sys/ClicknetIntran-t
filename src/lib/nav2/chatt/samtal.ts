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
import { kostnadUsd, sattInTal, utanMarken, type InsattTal, type Usage } from "./chattforma.ts";
import { SYSTEMTEXT } from "./systemtext.ts";
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
export type Klient = { beta: { messages: { stream(p: Record<string, unknown>): { finalMessage(): Promise<unknown> } } } };

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
  anrop: { namn: string; input: unknown }[];
  /** Verktygssvaren, i anropens ordning. */
  svar: Record<string, unknown>[];
  /** Svaret med märken (`⟦t1:12⟧`), eller null när frågan inte fick ett svar. */
  text: string | null;
  /** Svaret utan märken, som det sparas i loggen. */
  ren: string | null;
  tal: InsattTal[];
  obelagda: number;
  utkast: Utkast[];
};

export async function korSamtal(i: { klient: Klient; modell: string; turer: Tur[]; ctx: Ctx; sand: (h: Handelse) => void }): Promise<Samtalssvar> {
  const { klient, modell, ctx, sand } = i;
  const turer = [...i.turer];
  const ut: Samtalssvar = { stopp: "fel", usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, kostnadUsd: 0, anrop: [], svar: [], text: null, ren: null, tal: [], obelagda: 0, utkast: [] };
  try {
    for (let varv = 0; ; varv++) {
      if (varv >= MAX_VARV) {
        ut.stopp = "for-manga-varv";
        sand({ h: "fel", text: "Frågan tog för många steg. Försök med en smalare fråga." });
        return ut;
      }
      const m = (await klient.beta.messages
        .stream({
          model: modell,
          max_tokens: MAX_UT,
          system: [{ type: "text", text: SYSTEMTEXT, cache_control: { type: "ephemeral" } }],
          tools: VERKTYG,
          tool_choice: { type: "auto" },
          output_config: { effort: "low" },
          messages: turer,
          ...(harReserv(modell) ? { fallbacks: "default", betas: [FALLBACK_BETA] } : {}),
        })
        .finalMessage()) as Meddelande;

      const u = m.usage;
      ut.usage.input_tokens += u.input_tokens ?? 0;
      ut.usage.output_tokens += u.output_tokens ?? 0;
      ut.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      ut.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
      // Svarade reservmodellen prissätts den som den dyraste: gränsen ska aldrig underskattas.
      ut.kostnadUsd += kostnadUsd(m.model && m.model !== modell ? "okand" : modell, u);
      ut.stopp = m.stop_reason ?? "okant";

      if (ut.stopp === "refusal") {
        sand({ h: "avbojt", text: "Modellen avböjde att svara på det här. Jag svarar som sökrutan i stället." });
        return ut;
      }
      if (ut.stopp === "tool_use" || ut.stopp === "pause_turn") {
        turer.push({ role: "assistant", content: m.content });
        if (ut.stopp === "pause_turn") continue;
        const resultat: unknown[] = [];
        for (const block of m.content) {
          if (block.type !== "tool_use") continue;
          const namn = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          ut.anrop.push({ namn, input });
          sand({ h: "hamtar", text: hamtarText(namn, input) });
          const r = await korVerktyg(namn, input, ctx, ut.anrop.length);
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
      const text = m.content.flatMap((x) => (x.type === "text" && x.text ? [x.text] : [])).join("\n").trim();
      if (!text) {
        sand({ h: "fel", text: "Jag fick inget svar. Försök igen." });
        return ut;
      }
      const insatt = sattInTal(text, ut.svar);
      ut.text = insatt.text;
      ut.ren = utanMarken(insatt.text);
      ut.tal = insatt.tal;
      ut.obelagda = insatt.obelagda;
      sand({ h: "svar", text: insatt.text, tal: insatt.tal.map((t) => ({ ...t, om: kallrad(ut.svar[t.kalla.anrop - 1], t.kalla.falt) })), obelagda: insatt.obelagda, kalla: KALLRAD_AI, utkast: ut.utkast });
      return ut;
    }
  } catch (e) {
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
