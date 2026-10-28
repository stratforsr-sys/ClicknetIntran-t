import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { normalisera } from "@/lib/salesboard/installningar";
import {
  formaOgonblick,
  lasStatistik,
  tavlansFonster,
  vinnarensManad,
  type RaTavleHandelse,
  type RaTavleOrder,
  type RaTavlePaket,
  type RaTavlePerson,
  type RaTavleVal,
  type Tavlestatistik,
} from "@/lib/salesboard/forma";
import { nyckelFor } from "@/lib/salesboard/nyckel";
import { ANSTALLDKOLUMNER } from "@/lib/salesboard/skrivning";
import { lasningen, personvalen, saknasAn, varnaEnGang } from "@/lib/salesboard/saknas";
import type { Ogonblick } from "@/lib/salesboard/typer";

/**
 * Säljtavlan: ögonblicksbilden, läst med service role.
 *
 * Den här filen frågar och `forma.ts` räknar. Allt som avgör vad tavlan visar
 * (laget, månaden, målet, orderlistan, de dolda säljarna) står där och är
 * provat i `tests/salesboard-server.mjs`. Här står bara frågorna.
 *
 * ===========================================================================
 * SERVICE ROLE, OCH DÄRFÖR BARA EFTER `tavlansAtkomst`.
 *
 * En säljare får bara läsa sina egna order (RLS), och en parad TV har ingen
 * session alls. Tavlan visar laget, så raderna läses med service role, som
 * Golvet gör (`nav2/hem.ts`). Den som anropar `byggTavlan` ska därför ha
 * prövat åtkomsten först (`atkomst.ts`), och det som går ut är bara bilden ur
 * `formaOgonblick`, som är display-säker.
 * ===========================================================================
 *
 * ===========================================================================
 * 0250 BEHÖVER INTE VARA KÖRD, MEN "SAKNAS" GÄLLER BARA FÖRE 0250.
 *
 * Tabellerna `salesboard_person`, `salesboard_event` och funktionen
 * `salesboard_statistik` kommer med 0250. Saknas de går tavlan på standarderna:
 * ingen har valt att vara dold (det går inte att välja utan tabellen), inga
 * testhändelser och ingen statistik. Det sägs en gång i loggen (`saknas.ts`).
 *
 * Har statistiken eller testhändelserna svarat är 0250 körd, och då är en
 * tabell med säljarnas val som saknas ett fel (`personvalen`): att tro att
 * ingen valt att vara dold hade visat varje dold säljare med namn.
 *
 * Alla andra fel fäller bilden, med flit. En bild utan säljarnas val hade
 * visat den som valt att vara dold med namn, och en bild utan statistik hade
 * firat personbästa som inte är det. Rutten svarar då 503 och tavlan behåller
 * den bild den har.
 * ===========================================================================
 */

/** En bild gäller så här länge, så att många skärmar som ringer samtidigt delar på en läsning. */
const CACHE_MS = 2_000;

/** Kolumnerna tavlan läser ur `sales_order`, och inga andra: ingen provision, ingen kund, inga kontaktuppgifter. */
const ORDERKOLUMNER =
  "id, salesperson_id, package_id, term_months, signed_on, period_month, status, order_value, order_value_source, approved_at, cancelled_on, cancel_period_month";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bygget som svarar. Ett nytt värde får tavlan att ladda om (spec §8). */
const BYGGE = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "lokal";

/** En läsning som tavlan inte klarar sig utan gick fel. */
function las(vad: string, fel: { code?: string; message?: string } | null | undefined): never {
  throw new Error(`Säljtavlan: ${vad} gick inte att läsa: ${fel?.code ?? ""} ${fel?.message ?? "okänt fel"}`);
}

/**
 * Läser raderna och formar bilden. `skarm` sätts av `byggTavlan` per fråga.
 */
async function bygg(nu: Date): Promise<Ogonblick> {
  const db = supabaseAdmin();
  const fonster = tavlansFonster(nu);

  const { data: installning, error: installningsfel } = await db
    .from("nav_setting")
    .select("value")
    .eq("key", "salesboard")
    .maybeSingle();
  if (installningsfel) las("inställningarna", installningsfel);
  const installningar = normalisera((installning as { value?: unknown } | null)?.value);

  // Ett lag-id som inte är ett uuid är skräp, och skickat till PostgREST hade
  // det fällt frågan. Det räknas som alla.
  const lagId = installningar.lag !== null && UUID.test(installningar.lag) ? installningar.lag : null;
  const statistik = (lag: string | null) => db.rpc("salesboard_statistik", { p_dag: fonster.idag, p_lag: lag });
  const anstallda = (lag: string | null) => {
    // Status och roller avgör vem som står i topplistan utan order (R30), som i inställningarnas kort.
    const fraga = db.from("employee").select(ANSTALLDKOLUMNER);
    // Laget läses som Golvet läser det. Alla lag: hela tabellen, några tiotal rader mot API:ts tak på tusen.
    return lag !== null ? fraga.eq("team_id", lag) : fraga;
  };

  // Order läses för hela bolaget och laget väljs i `formaOgonblick`, så att allt
  // kan frågas på en gång. Det är några tiotal order i månaden, långt under
  // de tusen rader som API:t kapar vid.
  // Förra månadens order läses bara första arbetsdagen efter en tävling, för vinnaren.
  const forraManad = vinnarensManad(installningar, nu);
  const [lagSvar, forstaPersonSvar, valSvar, paketSvar, manadSvar, senasteSvar, forstaStatistikSvar, handelseSvar, forraSvar] =
    await Promise.all([
      lagId ? db.from("team").select("id, name").eq("id", lagId).maybeSingle() : null,
      anstallda(lagId),
      db.from("salesboard_person").select("employee_id, display"),
      db.from("sales_package").select("id, label"),
      db.from("sales_order").select(ORDERKOLUMNER).or(`period_month.eq.${fonster.manad},cancel_period_month.eq.${fonster.manad}`),
      db
        .from("sales_order")
        .select(ORDERKOLUMNER)
        .in("status", ["signerad", "betald"])
        .gte("approved_at", fonster.senasteFran)
        .order("approved_at", { ascending: false }),
      statistik(lagId),
      db
        .from("salesboard_event")
        .select("id, kind, payload, created_at")
        .eq("kind", "test")
        .gte("created_at", fonster.handelserFran)
        .order("id", { ascending: true }),
      forraManad
        ? db.from("sales_order").select(ORDERKOLUMNER).or(`period_month.eq.${forraManad},cancel_period_month.eq.${forraManad}`)
        : null,
    ]);

  if (lagSvar?.error) las("laget", lagSvar.error);
  if (paketSvar.error) las("paketen", paketSvar.error);
  if (manadSvar.error) las("månadens order", manadSvar.error);
  if (senasteSvar.error) las("de senaste orderna", senasteSvar.error);
  if (forraSvar?.error) las("förra månadens order", forraSvar.error);

  // Ett lag som inte finns längre: tavlan visar alla i stället för en tom
  // tavla, och personerna och statistiken läses om för alla.
  const lagRad = (lagSvar?.data ?? null) as { id: string; name: string } | null;
  const lag = lagId !== null && lagRad !== null ? { id: lagId, namn: lagRad.name } : null;
  let personSvar = forstaPersonSvar;
  let statistikSvar = forstaStatistikSvar;
  if (lagId !== null && lag === null) {
    varnaEnGang(`lag ${lagId}`, `Säljtavlan: laget ${lagId} finns inte. Tavlan visar alla.`);
    [personSvar, statistikSvar] = await Promise.all([anstallda(null), statistik(null)]);
  }
  if (personSvar.error) las("personerna", personSvar.error);

  // --- Det som kommer med 0250 ----------------------------------------------------
  const statistikLas = lasningen(statistikSvar.error);
  const handelseLas = lasningen(handelseSvar.error);
  if (statistikLas === "fel") las("statistiken", statistikSvar.error);
  if (handelseLas === "fel") las("testhändelserna", handelseSvar.error);
  if (statistikLas === "saknas") saknasAn("salesboard_statistik", statistikSvar.error);
  if (handelseLas === "saknas") saknasAn("salesboard_event", handelseSvar.error);

  const valet = personvalen(lasningen(valSvar.error), [statistikLas, handelseLas]);
  if (valet === "fel") {
    las(
      lasningen(valSvar.error) === "saknas" ? "säljarnas val (tabellen saknas fast resten av 0250 svarar)" : "säljarnas val",
      valSvar.error,
    );
  }
  if (valet === "inga") saknasAn("salesboard_person", valSvar.error);

  let tal: Tavlestatistik | null = null;
  if (statistikLas === "svar") {
    tal = lasStatistik(statistikSvar.data);
    if (tal === null) las("statistiken", { message: "svaret har fel form" });
  }

  return formaOgonblick(
    {
      lag,
      bygge: BYGGE,
      personer: (personSvar.data ?? []) as unknown as RaTavlePerson[],
      val: (valet === "rader" ? (valSvar.data ?? []) : []) as unknown as RaTavleVal[],
      paket: (paketSvar.data ?? []) as unknown as RaTavlePaket[],
      manadens: (manadSvar.data ?? []) as unknown as RaTavleOrder[],
      senaste: (senasteSvar.data ?? []) as unknown as RaTavleOrder[],
      statistik: tal,
      handelser: (handelseLas === "svar" ? (handelseSvar.data ?? []) : []) as unknown as RaTavleHandelse[],
      forraManadens: (forraSvar?.data ?? []) as unknown as RaTavleOrder[],
      nyckel: nyckelFor,
    },
    installningar,
    nu,
    null,
  );
}

/** Den senaste bilden, eller den som byggs just nu. Delas av alla frågor i processen. */
let cache: { t: number; bild: Promise<Ogonblick> } | null = null;

function cachad(): Promise<Ogonblick> {
  const t = Date.now();
  if (cache && t >= cache.t && t - cache.t < CACHE_MS) return cache.bild;

  const post = { t, bild: bygg(new Date(t)) };
  cache = post;
  // Ett misslyckat bygge ligger inte kvar: nästa fråga försöker igen.
  post.bild.catch(() => {
    if (cache === post) cache = null;
  });
  return post.bild;
}

/**
 * Ögonblicksbilden för en skärm (eller för en inloggad, `skarm` null).
 *
 * Bilden byggs högst en gång per två sekunder och process, och frågor som kommer
 * medan den byggs väntar på samma bygge. `nu` i bilden är när den byggdes, inte
 * när den skickades: tavlan släpper en bild som är äldre än den förra, och det
 * fungerar bara om två bilder med olika innehåll aldrig har samma eller omvänd tid.
 *
 * `skarm` läggs på per fråga och cachas aldrig. Med `nu` byggs en ny bild för
 * just den tiden, utan cachen.
 *
 * Kastar när en läsning går fel (se rubriken). Den som anropar svarar då med ett
 * fel, och tavlan behåller sin bild.
 */
export async function byggTavlan(skarm: { namn: string; ljud: boolean } | null, nu?: Date): Promise<Ogonblick> {
  const bas = nu ? await bygg(nu) : await cachad();
  return { ...bas, skarm: skarm ? { namn: skarm.namn, ljud: skarm.ljud } : null };
}
