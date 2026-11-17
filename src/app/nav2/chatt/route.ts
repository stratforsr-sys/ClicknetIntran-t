import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";
import { CHATT_NYCKLAR, EJ_KLAR_BESKED, PAGAR_BESKED, PAGAR_MS, arRadId, bilagaLogg, bilagaUsd, bilageBlock, farSlasPa, forePagar, kommandoFel, kortensUtfall, lasBilagor, lasChattInst, lasKommando, lasUtfall, maxFragaUsd, medUtfall, omRad, provNyckel, takBesked, vantarSlutrad } from "@/lib/nav2/chatt/chattforma";
import { skapaKallor } from "@/lib/nav2/chatt/kallor";
import { chattMiljo } from "@/lib/nav2/chatt/logg";
import { BESKED_AI, KORT_MAX, MAX_UT, MAX_VARV, fragetur, harReserv, historiaTurer, korSamtal, loggKostnadUsd, type Handelse, type Klient, type Samtalssvar, type Tur } from "@/lib/nav2/chatt/samtal";
import { FORSLAG_NYCKLAR, harNyttHem, lasForslagInst } from "@/lib/nav2/forslagforma";
import { INST_NYCKLAR, lasInstallningar, lokalDag, lokalKlockan } from "@/lib/nav2/motesflode";
import { avtryck } from "@/lib/nav2/chatt/systemtext";
import { KRETSFEL, VERKTYGSFEL, korVerktyg } from "@/lib/nav2/chatt/verktyg";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nav 2.0: chatten med Claude (designdokumentet, Steg 3).
 *
 *   POST {fraga, historia?: [{fraga, svar, hamtat?, kortUtfall?}], bilagor?: [{sort, namn, data}], om?: {sort, titel}}   svaret strömmas som händelser (text/event-stream):
 *     {h: "rad", id}                             alltid först: loggradens id, för stopp, utfall och Stämmer inte
 *     {h: "hamtar", text, anrop?, verktyg?}      vad som hämtas; `anrop` (från 1) finns för ett verktyg, inte för omskrivningen:
 *                                                utan `anrop` kontrolleras talen, och ett synligt utkast står kvar nedtonat
 *     {h: "klart", anrop, ok, text, ms}          verktyget med det numret är klart: källraden, eller felet när ok är falskt
 *     {h: "text", text, tal}                     utkastet: hela svaret så långt det får visas, i samma form som svar.text och
 *                                                svar.tal (inte ett tillägg). `text: ""` drar tillbaka det. Högst var 120:e ms.
 *     {h: "svar", text, tal, obelagda, kalla, kallor, kort, nasta, ja, underlag?, val?, varv, tider}   ersätter utkastet helt;
 *                                                `val: {fraga, alternativ}` när Claude frågar tillbaka (B2): ett klick
 *                                                ställer alternativet som nästa fråga, med historik
 *     {h: "avbojt", text} | {h: "fel", text, kod} felraden säger vad rutan kan göra (`Felkod` i samtal.ts); ett synligt
 *                                                utkast dras tillbaka (`text: ""`) före dem
 *   Efter svar, avbojt eller fel kommer inget mer. Strömmen stängs först när loggraden är rättad (R1): utfall och
 *   Stämmer inte väntar till dess. Klienten stoppar en fråga genom att avbryta sin fetch (AbortController): det som
 *   pågår hos Claude får bli klart och räknas, inget nytt anrop görs.
 *   En andra fråga medan den förra pågår får 429 med `kod: "pagar"`; en nådd gräns 429 med `tak: true, kod: "tak"`;
 *   utrymmet oläsbart 503 med `kod: "tillfalligt"`.
 *
 *   POST {stoppa: true, rad?}                    stoppar raden (eller, utan rad, alla personens pågående): {ok}; ogiltig rad 400
 *   POST {utfall: {rad, anrop, lage}}            kortets utfall (godkant, delvis, avbrutet, angrat) i loggradens verktyg[anrop-1]:
 *                                                {ok: true}; 400 ogiltigt, 404 ingen sådan rad eller inget kort som visades,
 *                                                409 `kod: "ej-klar"` medan raden pågår eller stoppas och är yngre än PAGAR_MS
 *                                                (försök igen när strömmen stängts), 503 när databasen inte svarar. Samma
 *                                                utfall två gånger skriver en gång, också samtidigt: skrivningen kräver att
 *                                                korten står som de lästes. `andrat?: ("titel"|"dag"|"till")[]` säger vad
 *                                                personen rättade före Godkänn, och skrivs bara med kortets första utfall.
 *   POST {kommando: {verktyg, input}}            rätta kortet före Godkänn: kortet byggs om av samma verktygskod, med
 *                                                personens behörighet och utan Claude. Bara de två förbered-verktygen.
 *                                                {kort}; 400 ogiltigt, 409 chatten av, 422 {fel} regeln sa nej (texten är
 *                                                till personen), 503 källan gick inte att läsa. Skriver ingenting.
 *   Hela protokollet för klienten: .lyft/chatt-server-api.md.
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
 * CLAUDE GÖR INGENTING. Åtta verktyg läser, med den inloggades behörighet (`verktyg.ts`). Två förbereder
 * ett kort som säger exakt vad som ska göras. Trycker personen på Godkänn skickar webbläsaren kortets steg
 * till Navs vanliga rutter, som den inloggade. Ett (fraga_tillbaka) ställer en fråga tillbaka med knappar, och ett
 * klick är bara nästa fråga. Den här rutten skriver aldrig något annat än sin egen logg.
 *
 * VARJE FRÅGA LOGGAS, också en som avböjdes eller föll: kostnaden ska räknas mot gränsen ändå.
 * Loggraden skrivs av reservationen, före anropet, och rättas till den verkliga kostnaden när svaret är
 * klart. Stänger personen fliken, eller avbryts funktionen, står raden kvar med den högsta kostnaden.
 * UTKASTET: svaret skrivs fram mening för mening, men bara hela meningar där varje tal redan har sin källa
 * (`slappUtkast`). Talen sätts in av servern också här, och en halv hänvisning syns aldrig. Varvet före första
 * verktygssvaret visas inte medan det skrivs. Slutar varvet i ett verktyg, tar en reservmodell över, avböjer
 * modellen eller faller frågan, dras utkastet tillbaka. Skrivs svaret om står det kvar, nedtonat, tills nästa utkast
 * eller svaret ersätter det. `svar` kommer alltid sist och ersätter det.
 */

/**
 * Ett utfall som krockar med ett annat på samma rad läses om och prövas igen, högst så här många gånger. Kommer
 * utfallen för alla korten i ett svar samtidigt (högst KORT_MAX), lyckas en skrivning per varv, så den sista behöver
 * KORT_MAX försök. Ett till räcker för ett kort som byter läge mitt i (godkänt, sedan ångrat).
 */
const UTFALL_FORSOK = KORT_MAX + 1;

/** Felraden lovar bara det rutan gör (N4): Försök igen och Sök i stället, båda med ett klick. */
const UTRYMME_BESKED = "Chattens utrymme gick inte att läsa. Försök igen om en stund, eller sök i stället.";
/** Samma löfte när chattens inställningar eller proven inte gick att läsa före frågan. */
const INSTFEL = "Chattens inställningar gick inte att läsa. Försök igen om en stund, eller sök i stället.";

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
  // En kropp som inte är ett objekt (`null`, en lista, en text) är lika ogiltig som en som inte går att läsa.
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ fel: "Ogiltig begäran." }, 400);
  // Stopp sägs också uttryckligen: en avbruten hämtning når inte alltid funktionen, och då skulle den stoppade
  // frågan spärra nästa tills den är klar. Bara personens egna pågående rader, och kostnaden står kvar reserverad.
  // Med `rad` stoppas bara den frågan: Stopp i en flik släpper inte en annan fliks fråga.
  if (b.stoppa === true) {
    if (b.rad !== undefined && b.rad !== null && !arRadId(b.rad)) return json({ fel: "Ogiltig rad." }, 400);
    let q = supabaseAdmin().from("nav_chatt_logg").update({ stop_reason: "stoppas" }).eq("employee_id", mig.id).eq("miljo", chattMiljo()).eq("stop_reason", "pagar");
    if (arRadId(b.rad)) q = q.eq("id", b.rad.toLowerCase());
    const { error } = await q;
    if (error) console.error(`chatt: de stoppade frågornas rader ändrades inte: ${error.message}`);
    return json({ ok: !error }, 200);
  }
  // Kortets utfall (Nav dömer sig självt): godkänt, avbrutet, ångrat eller fel, på personens egen rad i samma miljö.
  // Läs, sedan skriv, men skriv bara om korten står som de lästes (`kortensUtfall`): två utfall samtidigt på samma rad
  // (två kort, ett dubbelklick) tar då inte ut varandra. Krockar det läses raden om. Ingenting här räknas mot gränserna.
  if (b.utfall !== undefined) {
    const u = lasUtfall(b.utfall);
    if (!u.ok) return json({ fel: u.fel }, 400);
    const db = supabaseAdmin();
    for (let forsok = 0; forsok < UTFALL_FORSOK; forsok++) {
      const { data, error } = await db.from("nav_chatt_logg").select("verktyg, stop_reason, nar").eq("id", u.utfall.rad).eq("employee_id", mig.id).eq("miljo", chattMiljo()).maybeSingle();
      if (error) {
        console.error(`chatt: utfallet lästes inte: ${error.message}`);
        return json({ fel: "Utfallet gick inte att spara just nu." }, 503);
      }
      const rad = data as { verktyg?: unknown; stop_reason?: unknown; nar?: unknown } | null;
      if (!rad) return json({ fel: "Svaret finns inte." }, 404);
      // R1: svaret kommer före loggens slutrad, och slutraden skriver hela `verktyg`. Ett utfall på en rad som ännu inte
      // är klar (`pagar`, eller `stoppas` i väntan på slutraden) hade skrivits över, så det tas inte emot än. En sådan
      // rad äldre än PAGAR_MS får aldrig sin slutrad; den har inga kort, och utfallet får 404 nedan.
      if (vantarSlutrad(rad.stop_reason, rad.nar, Date.now())) return json({ fel: EJ_KLAR_BESKED, kod: "ej-klar" }, 409);
      const med = medUtfall(rad.verktyg, u.utfall, new Date().toISOString());
      if (!med) return json({ fel: "Det finns inget kort med det numret." }, 404);
      // Samma utfall igen (dubbelklick, omförsök): inget skrivs, och första tiden står kvar.
      if (!med.andrad) return json({ ok: true }, 200);
      let q = db.from("nav_chatt_logg").update({ verktyg: med.verktyg }).eq("id", u.utfall.rad).eq("employee_id", mig.id).eq("miljo", chattMiljo());
      for (const [i, v] of kortensUtfall(rad.verktyg)) q = v === null ? q.is(`verktyg->${i}->>utfall`, null) : q.eq(`verktyg->${i}->>utfall`, v);
      const { data: skrivna, error: felSkriv } = await q.select("id");
      if (felSkriv) {
        console.error(`chatt: utfallet skrevs inte: ${felSkriv.message}`);
        return json({ fel: "Utfallet gick inte att spara just nu." }, 503);
      }
      if (Array.isArray(skrivna) && skrivna.length > 0) return json({ ok: true }, 200);
      // Ett annat utfall hann skrivas mellan läsningen och skrivningen: läs om och pröva igen.
    }
    return json({ fel: EJ_KLAR_BESKED, kod: "ej-klar" }, 409);
  }
  // Rätta kortet före Godkänn (funktion 6): kortet byggs om av samma verktygskod som Claudes, med samma prövning (titel,
  // dag, vem uppgiften får läggas åt, affären personen ser), som den inloggade. Ingen Claude, ingen loggrad, ingenting
  // räknas mot gränserna, och ingenting skrivs: kortet görs först när personen trycker Godkänn, genom Navs vanliga
  // rutter. Grenen vet inte vilket kort som rättas; det som ändrades kommer med kortets utfall (`andrat`).
  if (b.kommando !== undefined) {
    const k = lasKommando(b.kommando);
    if (!k.ok) return json({ fel: k.fel }, 400);
    const { data: instRader, error: instFel } = await supabaseAdmin().from("nav_setting").select("key, value").in("key", [...Object.values(CHATT_NYCKLAR), FORSLAG_NYCKLAR.hemNytt, INST_NYCKLAR.tidszon]).limit(50);
    // Inställningarna gick inte att läsa: det är ett läsfel som kan försökas igen, inte "Chatten är inte påslagen.".
    if (instFel) {
      console.error(`chatt: inställningarna gick inte att läsa: ${instFel.message}`);
      return json({ fel: VERKTYGSFEL, kod: "tillfalligt" }, 503);
    }
    const rader = (instRader ?? []) as { key: string; value: unknown }[];
    if (!lasChattInst(rader).pa || !harNyttHem(lasForslagInst(rader), mig.id)) return json({ fel: "Chatten är inte påslagen." }, 409);
    const r = await korVerktyg(k.kommando.verktyg, k.kommando.input, { mig: mig.id, idag: lokalDag(new Date(), lasInstallningar(rader).tidszon), kallor: skapaKallor(user) }, 1);
    if (!r.kort) {
      // En källa som inte gick att läsa (också kretsen) är 503 och kan försökas igen; en regel som sa nej är 422.
      const fel = typeof r.svar.fel === "string" ? r.svar.fel : VERKTYGSFEL;
      return fel === VERKTYGSFEL || fel === KRETSFEL ? json({ fel, kod: "tillfalligt" }, 503) : json({ fel: kommandoFel(fel) }, 422);
    }
    return json({ kort: { ...r.kort, verktyg: k.kommando.verktyg, input: k.kommando.input } }, 200);
  }
  // Styrtecken tas bort: Postgres tar inte emot dem i en text, och en fråga som inte går att logga får inte ställas.
  const fraga = String(b.fraga ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1000);
  if (fraga.length < 3) return json({ fel: "Frågan är för kort." }, 400);
  // O, "Om den här": det frågan gäller, en sort ur en fast lista och en kort titel. Det står som data på raden före
  // frågan (`omRad`, samma form i provet). Går det inte att läsa svarar rutten 400 i stället för att tyst släppa det:
  // annars visar klienten något som Claude aldrig fick.
  const om = omRad(b.om);
  if (om === null) return json({ fel: "Ogiltig begäran." }, 400);
  // Bilder och PDF går till Claude i frågans tur. De sparas aldrig, och loggen får bara antal och sort.
  const bil = lasBilagor(b.bilagor);
  if (!bil.ok) return json({ fel: bil.fel }, 400);
  const bilagor = bil.bilagor;

  const db = supabaseAdmin();
  // Inställningarna och de godkända proven läses samtidigt: båda behövs före första livstecknet, ingen beror på den andra.
  const [{ data: instRader, error: instFel }, { data: prov, error: provFel }] = await Promise.all([
    db.from("nav_setting").select("key, value").in("key", [...Object.values(CHATT_NYCKLAR), FORSLAG_NYCKLAR.hemNytt, INST_NYCKLAR.tidszon]).limit(50),
    db.from("nav_chatt_prov").select("modell, avtryck, godkand").eq("godkand", true).limit(200),
  ]);
  // Ett läsfel är inte "Chatten är inte påslagen." och inte "Modellen har inget godkänt prov.": det är tillfälligt, och
  // personen får Försök igen och Sök i stället. Ingen rad är reserverad än, och ingenting har gått till Claude.
  if (instFel || provFel) {
    console.error(`chatt: ${instFel ? "inställningarna" : "proven"} gick inte att läsa: ${(instFel ?? provFel)!.message}`);
    return json({ fel: INSTFEL, kod: "tillfalligt" }, 503);
  }
  const rader = (instRader ?? []) as { key: string; value: unknown }[];
  const inst = lasChattInst(rader);
  // Samma svar till den som inte har det nya hemmet: skrivrutan är inte den enda vägen hit.
  if (!inst.pa || !harNyttHem(lasForslagInst(rader), mig.id)) return json({ fel: "Chatten är inte påslagen." }, 409);

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
  const hogst = maxFragaUsd(harReserv(modell) ? "okand" : modell, MAX_UT, MAX_VARV) + bilagaUsd(harReserv(modell) ? "okand" : modell, bilagor, MAX_VARV);
  const { data: resSvar, error: resFel } = await db.rpc("nav_chatt_reservera", { p_miljo: miljo, p_employee: mig.id, p_modell: modell, p_max_usd: hogst, p_fraga: (om ? `${om} ` : "") + fraga + bilagaLogg(bilagor) });
  const res = resSvar as { ok?: unknown; id?: unknown; skal?: unknown } | null;
  if (resFel || !res || typeof res.ok !== "boolean") return json({ fel: UTRYMME_BESKED, kod: "tillfalligt" }, 503);
  if (!res.ok) return json({ fel: takBesked(res.skal), tak: true, kod: "tak" }, 429);
  if (typeof res.id !== "string" || !res.id) return json({ fel: UTRYMME_BESKED, kod: "tillfalligt" }, 503);
  const radId = res.id;

  // En fråga i taget per person, också från två flikar. Gick spärren inte att läsa ställs frågan: den är ett skydd, inte en grind.
  const { data: pagar } = await db.from("nav_chatt_logg").select("id, nar").eq("employee_id", mig.id).eq("miljo", miljo).eq("stop_reason", "pagar").gte("nar", new Date(Date.now() - PAGAR_MS).toISOString()).limit(20);
  if (forePagar(pagar, radId, Date.now(), PAGAR_MS)) {
    // Raden tas bort: frågan gick aldrig till Claude, och ska varken kosta eller räknas som en ställd fråga.
    const { error } = await db.from("nav_chatt_logg").delete().eq("id", radId).eq("stop_reason", "pagar");
    if (error) console.error(`chatt: den dubbla frågans rad togs inte bort: ${error.message}`);
    return json({ fel: PAGAR_BESKED, kod: "pagar" }, 429);
  }

  const nu = new Date();
  // Dagen och klockan i företagets tidszon (`moten.tidszon`, förvalt Europe/Stockholm), läst i samma runda som chattens
  // inställningar. Verktygens perioder och "data per" räknas från samma dag.
  const tidszon = lasInstallningar(rader).tidszon;
  const idag = lokalDag(nu, tidszon);
  // Historiken byggs av samma funktion som provet använder (A2-3).
  const turer: Tur[] = historiaTurer(b.historia);
  const fragan = fragetur({ idag, klocka: lokalKlockan(nu, tidszon), fornamn: mig.first_name, roller: user.roles, fraga, om: b.om });
  turer.push({ role: "user", content: bilagor.length ? [...bilageBlock(bilagor), { type: "text", text: fragan }] : fragan });

  const klient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
    maxRetries: 1,
    timeout: 60_000,
  });
  const kallor = skapaKallor(user);
  const enc = new TextEncoder();

  // Personen slutar lyssna när strömmen avbryts (Stopp, en stängd flik). Inget nytt anrop görs då, men frågan räknas.
  const avbruten = new AbortController();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const strom = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
    cancel() {
      avbruten.abort();
    },
  });
  let avslutad = false;
  const sand = (h: Handelse) => {
    if (avslutad) return;
    if (h.h === "svar" || h.h === "avbojt" || h.h === "fel") avslutad = true;
    try {
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify(h)}\n\n`));
    } catch {
      // Strömmen är stängd: ingen lyssnar längre.
      avbruten.abort();
    }
  };

  // Stoppad fråga: raden slutar genast spärra nästa fråga ("stoppas"), medan kostnaden står kvar reserverad tills
  // anropet som pågår är klart. Villkoret på "pagar" gör att den aldrig skriver över den slutliga rättningen.
  let samtaletKlart = false;
  let stoppas: Promise<void> | null = null;
  avbruten.signal.addEventListener("abort", () => {
    if (samtaletKlart) return;
    stoppas = Promise.resolve(db.from("nav_chatt_logg").update({ stop_reason: "stoppas" }).eq("id", radId).eq("stop_reason", "pagar")).then(
      ({ error }) => { if (error) console.error(`chatt: den stoppade frågans rad ändrades inte: ${error.message}`); },
      (e: unknown) => { console.error(`chatt: den stoppade frågans rad ändrades inte: ${e instanceof Error ? e.message : String(e)}`); },
    );
  }, { once: true });

  // Första händelsen: raden frågan loggas på. Med den kan klienten stoppa just den här frågan och skicka kortens utfall.
  sand({ h: "rad", id: radId });

  // Arbetet startar nu och hålls vid liv av `after` tills loggraden är rättad, också om personen stänger fliken.
  const jobb = (async () => {
    const start = Date.now();
    let r: Samtalssvar | null = null;
    try {
      r = await korSamtal({ klient: klient as unknown as Klient, modell, turer, ctx: { mig: mig.id, idag, kallor }, sand, avbruten: avbruten.signal, fraga });
    } catch (e) {
      console.error(`chatt: ${e instanceof Error ? e.message : String(e)}`);
      sand({ h: "fel", text: BESKED_AI, kod: "ai" });
    }
    samtaletKlart = true;
    try {
      if (stoppas) await stoppas;
      // Utan svar vet ingen vad frågan kostade: raden får det reserverade beloppet, och slutar vara pågående.
      const rad = r
        ? {
            tokens_in: r.usage.input_tokens, tokens_ut: r.usage.output_tokens, tokens_cache_las: r.usage.cache_read_input_tokens, tokens_cache_skriv: r.usage.cache_creation_input_tokens,
            verktyg: r.anrop, stop_reason: r.stopp, ms: Date.now() - start, kostnad_usd: loggKostnadUsd(r, hogst), kostnad_kr: loggKostnadUsd(r, hogst) * inst.krPerDollar, obelagda: r.obelagda, omskrivet: r.omskrivet, reserv: r.reserv, svar: r.ren,
          }
        : { stop_reason: "fel", ms: Date.now() - start, kostnad_usd: hogst, kostnad_kr: hogst * inst.krPerDollar };
      const { error } = await db.from("nav_chatt_logg").update(rad).eq("id", radId);
      // Går rättningen inte att skriva står reservationen kvar: frågan räknas då som det mesta den kunde kosta.
      if (error) console.error(`chatt: loggraden rättades inte: ${error.message}`);
      // Mätningen före varje påstående om tid (A1-6): varv, ms per anrop och verktygsvarv, första utkastet. Ingen text ur frågan.
      if (r && process.env.VERCEL_ENV) console.info(`chatt: tider rad=${radId} stopp=${r.stopp} varv=${r.varv} ai=${r.tider.ai.join(",")} verktyg=${r.tider.verktyg.join(",")} forstaText=${r.tider.forstaText ?? "-"} totalt=${r.tider.totalt}`);
    } catch (e) {
      console.error(`chatt: loggraden rättades inte: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      avslutad = true;
      try {
        ctrl.close();
      } catch {
        // Redan stängd av den som lyssnade.
      }
    }
  })();
  after(jobb);

  return new Response(strom, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}
