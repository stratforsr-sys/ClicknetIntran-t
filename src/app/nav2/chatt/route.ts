import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svenskKlocka, svensktDatum } from "@/lib/klocka";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";
import { CHATT_NYCKLAR, farSlasPa, lasChattInst, maxFragaUsd, provNyckel, takBesked, utanTal } from "@/lib/nav2/chatt/chattforma";
import { skapaKallor } from "@/lib/nav2/chatt/kallor";
import { chattMiljo } from "@/lib/nav2/chatt/logg";
import { MAX_UT, MAX_VARV, fragetur, harReserv, korSamtal, type Handelse, type Klient, type Tur } from "@/lib/nav2/chatt/samtal";
import { FORSLAG_NYCKLAR, harNyttHem, lasForslagInst } from "@/lib/nav2/forslagforma";
import { avtryck } from "@/lib/nav2/chatt/systemtext";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nav 2.0: chatten med Claude (designdokumentet, Steg 3).
 *
 *   POST {fraga, historia?: [{fraga, svar}]}   svaret strömmas som händelser (text/event-stream):
 *     {h: "hamtar", text}                        vad som hämtas medan ett verktyg kör
 *     {h: "svar", text, tal, obelagda, kalla, utkast}
 *     {h: "avbojt", text} | {h: "fel", text}     skrivrutan svarar då som sökrutan
 *
 * AVSTÄNGD tills någon slår på den: utan `chatt.pa` svarar rutten 409 innan något annat händer, och
 * skrivrutan svarar som paletten. Detsamma för den som inte har det nya hemmet (`hem.nytt`). Påslagen
 * kräver den dessutom, vid varje fråga: nyckeln i miljön, ett bekräftat avtal och ett godkänt prov för
 * just den här modellen, systemtexten och verktygslistan (`farSlasPa`). Triggern (0304, 0305) håller
 * samma sak i databasen.
 *
 * GRÄNSERNA (0305): dollar per person och för företaget, varje kalendermånad. Före anropet reserverar
 * frågan det mesta den kan kosta, i samma steg som gränserna prövas (`nav_chatt_reservera`). Ryms den
 * inte svarar rutten 429 och ingenting går till Claude.
 *
 * CLAUDE SKRIVER ALDRIG ETT TAL. Den hänvisar till ett fält i ett verktygssvar, och `sattInTal` sätter in
 * värdet med källa. En siffra utan hänvisning märks ut och räknas i loggen.
 *
 * CLAUDE GÖR INGENTING. Fem verktyg läser, med den inloggades behörighet (`verktyg.ts`). Det sjätte
 * förbereder ett utkast till uppgifter som personen själv lägger in.
 *
 * VARJE FRÅGA LOGGAS, också en som avböjdes eller föll: kostnaden ska räknas mot gränsen ändå.
 * Loggraden skrivs av reservationen, före anropet, och rättas till den verkliga kostnaden när svaret är
 * klart. Stänger personen fliken, eller avbryts funktionen, står raden kvar med den högsta kostnaden.
 * Svaret skickas i ett stycke när det är klart, inte tecken för tecken: talen sätts in av servern, och
 * en halv hänvisning ska aldrig synas.
 */

const json = (data: unknown, status: number) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "Cache-Control": "private, no-store, max-age=0" } });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return json({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return json({ fel: "Fel ursprung." }, 403);
  const mig = user.employee;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ fel: "Ogiltig begäran." }, 400);
  }
  // Styrtecken tas bort: Postgres tar inte emot dem i en text, och en fråga som inte går att logga får inte ställas.
  const fraga = String(b.fraga ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1000);
  if (fraga.length < 3) return json({ fel: "Frågan är för kort." }, 400);

  const db = supabaseAdmin();
  const { data: instRader } = await db.from("nav_setting").select("key, value").in("key", [...Object.values(CHATT_NYCKLAR), FORSLAG_NYCKLAR.hemNytt]).limit(50);
  const rader = (instRader ?? []) as { key: string; value: unknown }[];
  const inst = lasChattInst(rader);
  // Samma svar till den som inte har det nya hemmet: skrivrutan är inte den enda vägen hit.
  if (!inst.pa || !harNyttHem(lasForslagInst(rader), mig.id)) return json({ fel: "Chatten är inte påslagen." }, 409);

  const { data: prov } = await db.from("nav_chatt_prov").select("modell, avtryck, godkand").eq("godkand", true).limit(200);
  const far = farSlasPa({
    nyckel: !!process.env.ANTHROPIC_API_KEY,
    avtal: inst.avtal,
    modell: inst.modell,
    avtryck: avtryck(),
    godkandaProv: ((prov ?? []) as { modell: string; avtryck: string; godkand: boolean }[]).filter((p) => p.godkand === true).map((p) => provNyckel(p.modell, p.avtryck)),
  });
  if (!far.ok) return json({ fel: far.skal }, 409);

  const miljo = chattMiljo();
  const modell = inst.modell;
  // Kan reservmodellen ta över räknas det mesta frågan kan kosta till den dyraste modellens pris.
  const hogst = maxFragaUsd(harReserv(modell) ? "okand" : modell, MAX_UT, MAX_VARV);
  const { data: resSvar, error: resFel } = await db.rpc("nav_chatt_reservera", { p_miljo: miljo, p_employee: mig.id, p_modell: modell, p_max_usd: hogst, p_fraga: fraga });
  const res = resSvar as { ok?: unknown; id?: unknown; skal?: unknown } | null;
  if (resFel || !res || typeof res.ok !== "boolean") return json({ fel: "Chattens utrymme gick inte att läsa, så jag svarar som sökrutan." }, 503);
  if (!res.ok) return json({ fel: takBesked(res.skal), tak: true }, 429);
  if (typeof res.id !== "string" || !res.id) return json({ fel: "Chattens utrymme gick inte att läsa, så jag svarar som sökrutan." }, 503);
  const radId = res.id;

  const nu = new Date();
  const idag = svensktDatum(nu);
  const historia = (Array.isArray(b.historia) ? (b.historia as Record<string, unknown>[]) : [])
    .filter((h) => h && typeof h.fraga === "string" && typeof h.svar === "string" && h.fraga.trim() && h.svar.trim())
    .slice(-3);
  const turer: Tur[] = historia.flatMap((h): Tur[] => [
    { role: "user", content: String(h.fraga).slice(0, 1000) },
    { role: "assistant", content: utanTal(String(h.svar)).slice(0, 2000) },
  ]);
  turer.push({ role: "user", content: fragetur({ idag, klocka: svenskKlocka(nu), fornamn: mig.first_name, roller: user.roles, fraga }) });

  const klient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
    maxRetries: 1,
    timeout: 60_000,
  });
  const kallor = skapaKallor(user);
  const enc = new TextEncoder();

  const strom = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const start = Date.now();
      // Har personen stängt fliken kastar strömmen. Frågan ska räknas och loggas ändå.
      const sand = (h: Handelse) => {
        try {
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify(h)}\n\n`));
        } catch {
          /* ingen lyssnar längre */
        }
      };
      const r = await korSamtal({ klient: klient as unknown as Klient, modell, turer, ctx: { mig: mig.id, idag, kallor }, sand });
      const { error } = await db
        .from("nav_chatt_logg")
        .update({
          tokens_in: r.usage.input_tokens, tokens_ut: r.usage.output_tokens, tokens_cache_las: r.usage.cache_read_input_tokens, tokens_cache_skriv: r.usage.cache_creation_input_tokens,
          verktyg: r.anrop, stop_reason: r.stopp, ms: Date.now() - start, kostnad_usd: r.kostnadUsd, kostnad_kr: r.kostnadUsd * inst.krPerDollar, obelagda: r.obelagda, svar: r.ren,
        })
        .eq("id", radId);
      // Går rättningen inte att skriva står reservationen kvar: frågan räknas då som det mesta den kunde kosta.
      if (error) console.error(`chatt: loggraden rättades inte: ${error.message}`);
      try {
        ctrl.close();
      } catch {
        /* redan stängd */
      }
    },
  });

  return new Response(strom, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}
