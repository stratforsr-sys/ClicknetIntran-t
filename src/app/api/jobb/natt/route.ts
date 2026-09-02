import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { korTidjobbet } from "@/lib/jobb/tid";
import { korKontojobbet } from "@/lib/jobb/konton";
import { korArendejobbet } from "@/lib/jobb/arenden";
import { korFranvarojobbet } from "@/lib/jobb/franvaro";
import { korSatsjobbet } from "@/lib/jobb/satser";
import { korGuidejobbet } from "@/lib/jobb/guider";
import { korCoachningsjobbet } from "@/lib/jobb/coachning";
import { foreslaOgiltigFranvaro } from "@/lib/jobb/konsekvenser";
import { hamtaDrift, type Drift } from "@/lib/jobb/drift-server";
import { kvittoLarmtext, larmDigest, larmSokvag } from "@/lib/jobb/larm";
import { skrivFel } from "@/lib/fel-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ett nattjobb i stället för tre.
 *
 * Bakgrunden är inte estetisk. Tre cron-poster deklarerades i `vercel.json`,
 * och ingen av dem kördes — Hobby-planen tar två per projekt. Följden var tyst:
 * en instämpling stod öppen i två dygn, journalen fick inga rader och ingen sen
 * ankomst upptäcktes. Ett schemalagt jobb som inte kör ser likadant ut som ett
 * som inte hade något att göra.
 *
 * Nu körs allt från en post. Varje steg körs för sig och ett fel i ett steg
 * stoppar inte de andra — men det syns i svaret, och svaret sparas i loggen så
 * att en utebliven körning går att se i efterhand.
 *
 * ===========================================================================
 * E0.7: KVITTOT FANNS REDAN, DET INGEN GJORDE VAR ATT TITTA PÅ DET
 *
 * Sedan 2026-08-27 larmar jobbet om sig självt, på två sätt:
 *
 *   1. VARJE STEG SOM FALLER blir en rad i `error_report`, alltså i samma kö
 *      som allt annat som gått sönder. Digesten är stabil över nätter
 *      (`larm.ts`), så ett steg som faller varje natt i en månad blir en rad
 *      med räknaren 30 och inte trettio rader.
 *   2. JOBBET KONTROLLERAR SITT EGET FÖREGÅENDE KVITTO. Är det äldre än 26
 *      timmar hoppades en natt över, och det larmas även när nattens körning
 *      gick igenom. Ett jobb som kör igen efter ett avbrott ska inte tysta
 *      spåret av avbrottet.
 *
 * Punkt 2 fångar inte fallet att jobbet slutar köra helt — då finns det ingen
 * som kör kontrollen. Den delen ligger på en mänsklig väg i stället: ett
 * driftkort på `/fel` och en rad på startsidan. En cron som vaktar cron dör
 * samma död, och det var precis det som hände här.
 * ===========================================================================
 */
export async function GET(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;

  const db = supabaseAdmin();
  const lage = await hamtaLage();
  const start = Date.now();
  const resultat: Record<string, unknown> = {};
  const fel: Record<string, string> = {};

  /**
   * Det egna kvittot läses FÖRE stegen, så att "senaste" betyder den förra
   * körningen och inte den som pågår.
   *
   * Service role, till skillnad från vyerna: jobbet har ingen inloggad
   * användare, och dess egen hälsa ska inte hänga på vem som råkar titta.
   *
   * EGET TRY/CATCH, av samma skäl som varje steg har ett. Kontrollen är
   * jobbets minst viktiga uppgift och står först i filen — ett nätavbrott här
   * hade annars fällt hela natten innan en enda stämpling stängts. Ett larm
   * som kan släcka det den vaktar är värre än inget larm.
   */
  let forra: Drift;
  try {
    forra = await hamtaDrift(db, new Date(start));
  } catch (e) {
    fel["kvitto"] = e instanceof Error ? e.message : String(e);
    // Okänt läge, inte "aldrig": att larma om en utebliven natt vore att dra
    // en slutsats ur en fråga som aldrig fick något svar.
    forra = { besked: { lage: "ok", timmar: null }, kvitto: null };
  }

  const steg: [string, () => Promise<unknown>][] = [
    ["tid", () => (lage.stampling ? korTidjobbet(db, lage.rast) : Promise.resolve({ hoppade_over: "stämplingen är av" }))],
    // E13 steg 6: forslag om utebliven instampling. Steget FORESLAR bara — en
    // foreslagen handelse har ingen konsekvens forran en chef godkant den.
    //
    // Det kor bara nar stamplingen ar pa, och det ar inte en optimering: utan
    // stampling saknar alla instampling varje dag, och jobbet hade lagt ett
    // forslag pa varenda anstalld och varenda arbetsdag.
    [
      "konsekvenser",
      () =>
        lage.stampling
          ? foreslaOgiltigFranvaro(db)
          : Promise.resolve({ hoppade_over: "stämplingen är av" }),
    ],
    ["konton", () => korKontojobbet(db)],
    ["arenden", () => korArendejobbet(db)],
    // E7: eskalering av obekraftade sjukanmalningar, K37-frister och
    // paminnelser om oregistrerad franvaro. Steget kor aven nar stamplingen ar
    // av — bara paminnelserna kraver den, och det avgor jobbet sjalvt.
    ["franvaro", () => korFranvarojobbet(db, lage.stampling)],
    // E15.8/K28: satser vars datum for oversyn passerat ger ett arende till
    // agaren. En foraldrad arbetsgivaravgift ger fel lonekostnad utan att
    // nagonstans se fel ut.
    ["satser", () => korSatsjobbet(db)],
    // G6: den som varit anstalld over fristen utan att ga igenom sina
    // systemguider ger ett arende till narmaste chef. Guiderna laser ingenting,
    // sa utan det har steget finns ingen som marker att onboardingen uteblev.
    ["guider", () => korGuidejobbet(db, lage.stampling)],
    // Coachningsuppgifter 14 dagar over fristen ger ett arende till narmaste
    // chef. Klockan har redan sagt till om det som statt still i tre dygn; det
    // har steget fangar det ingen tagit tag i. De sjalvsanna typerna star
    // utanfor — en forsenad kurs har sin egen uppfoljning i M6.
    ["coachning", () => korCoachningsjobbet(db)],
  ];

  for (const [namn, kor] of steg) {
    try {
      resultat[namn] = await kor();
    } catch (e) {
      fel[namn] = e instanceof Error ? e.message : String(e);
    }
  }

  const sekunder = Math.round((Date.now() - start) / 100) / 10;

  /**
   * E0.7. Larmen.
   *
   * `skrivFel()` är enda vägen in i `error_report` och kastar aldrig — ett fel
   * i larmet får inte bli det fel som fäller jobbet. Returvärdet räknas ändå,
   * och antalet skrivs i kvittot: annars är "inga larm" och "larmen gick inte
   * att skriva" samma tystnad, och det är precis den förväxlingen hela epicet
   * handlar om.
   *
   * `blocking` är FALSKT även här, och det är avsiktligt. Fältet svarar på om
   * en människa hindrades från att jobba vidare (0026), inte på hur allvarligt
   * felet är. Ett larm som lånar fältet för att hamna högt i kön hade gjort
   * flaggan obrukbar för det den finns till. Kön sorterar `new` överst ändå,
   * och det som faktiskt blir sett är raden på startsidan.
   */
  const larm: Promise<boolean>[] = [];

  for (const [namn, meddelande] of Object.entries(fel)) {
    larm.push(
      skrivFel({
        kind: "automatic",
        // Sökvägen bär steget. `rensaSokvag()` klipper bort fragment, så
        // `#satser` hade grupperat ihop alla sex stegen till en rad.
        path: larmSokvag(namn),
        digest: larmDigest(namn, meddelande),
        message: `Nattjobbets steg "${namn}" foll: ${meddelande}`,
        blocking: false,
      }),
    );
  }

  // Den uteblivna natten. Larmas ÄVEN när nattens körning gick igenom — ett
  // jobb som kommer tillbaka efter ett avbrott ska inte tysta spåret av
  // avbrottet. `aldrig` larmas inte: första gången jobbet någonsin kör finns
  // det inget kvitto, och det är inte ett fel.
  if (forra.besked.lage === "forsenat") {
    const text = kvittoLarmtext(forra.besked);
    larm.push(
      skrivFel({
        kind: "automatic",
        path: larmSokvag("kvitto"),
        digest: larmDigest("kvitto", text),
        message: text,
        blocking: false,
      }),
    );
  }

  const skrivna = (await Promise.all(larm)).filter(Boolean).length;

  // Kvittot pa att jobbet kort. Utan det gar det inte att skilja "inget hande"
  // fran "ingenting kordes" — och det var precis den skillnaden som kostade tva
  // dygn av oupptackt oppen stampling.
  await db.from("audit_log").insert({
    actor_id: null,
    action: Object.keys(fel).length > 0 ? "job.night_partial" : "job.night_ok",
    object_type: "job",
    object_id: "natt",
    meta: {
      sekunder,
      resultat,
      fel,
      // Larmen som faktiskt skrevs, och hur gammalt det forra kvittot var.
      // Bada star har for att en manniska ska kunna svara pa "larmade den
      // natten" utan att gissa ur `error_report`.
      larm: skrivna,
      forra_kvittot: { lage: forra.besked.lage, timmar: forra.besked.timmar },
    },
  });

  return NextResponse.json(
    {
      sekunder,
      larm: skrivna,
      forra_kvittot: forra.besked,
      ...resultat,
      ...(Object.keys(fel).length > 0 ? { fel } : {}),
    },
    { status: Object.keys(fel).length > 0 ? 500 : 200 },
  );
}
