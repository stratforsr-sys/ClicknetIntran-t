import { getCurrentUser } from "@/lib/auth";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { medNyckel } from "@/lib/nav2/nyckel";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";
import { tavlansAdmin } from "@/lib/salesboard/atkomst";
import { lasSaljareOchTroskel, lasSkarmar, type Dbfel } from "@/lib/salesboard/installningsdata";
import { hasha } from "@/lib/salesboard/parning";
import { saknasAn } from "@/lib/salesboard/saknas";
import {
  FEL,
  HANDELSER,
  atkomstsvar,
  efterForsok,
  parningsutfall,
  nastaStampel,
  planeraSparning,
  tolkaSkrivning,
  type Atkomstlage,
  type Delar,
  type Installningsrad,
  type Skrivning,
} from "@/lib/salesboard/skrivning";
import { svar } from "@/lib/salesboard/svar";

export const dynamic = "force-dynamic";

/**
 * Säljtavlan: allt som ändrar tavlan, i en rutt (spec §7 och §9).
 *
 *   POST, `{handling, …}`:
 *   spara        delar av inställningarna (`nav_setting` "salesboard")
 *   para         en kod från TV:n och ett namn: skärmen skapas och koden löses in
 *   byt_namn     en skärms namn
 *   ljud_skarm   om en skärm spelar ljud
 *   koppla_bort  skärmen kopplas bort och dess token slutar gälla
 *   person       en säljares visning (namn, initialer, dold)
 *   testa        en testhändelse som alla skärmar spelar med märket TEST
 *
 *   GET: skärmarna, `{skarmar, nu}`. Inställningssidan frågar var 30:e sekund
 *   efter "sedd för …", och en dålig läsning stannar i skärmkortet.
 *
 * ===========================================================================
 * BARA ADMIN, FRÅN NAVETS EGEN SIDA. `/salesboard` står i mellanvarans
 * `PUBLIC` (en TV har ingen session), så rutten avgör själv. En skrivning prövar
 * först samma ursprung (rutten tar kakor, och en annan sajt får inte ens fråga
 * vem som är inloggad); en läsning har inget att förfalska och prövas inte på
 * det. Sedan nivån admin eller superadmin (`tavlansAdmin`). Bara ett säkert nej
 * ger nej: utan session 401, en säljare 403. Går det inte att veta (databasen
 * svarar inte) blir det 503, aldrig 401 eller 403 (`atkomstsvar`).
 *
 * INGENTING TAPPAS TYST. Kroppen tolkas i `skrivning.ts`: varje del prövas,
 * och en del som inte landar som den skickades ger 400 med delen, i stället
 * för ett ok som sparade något annat.
 *
 * INGEN SPARNING SKRIVER ÖVER EN ANNAN (R25). Inställningarna är en rad, och
 * skrivningen gäller bara om raden fortfarande har det `updated_at` som lästes.
 * Hann någon emellan läses raden om och delarna läggs ovanpå den nya, en gång.
 * Krockar det igen svarar rutten 409 och ingenting sparas.
 *
 * EN SKRIVNING EN GÅNG. Allt går genom `medNyckel`: samma `X-Nav-Nyckel` en
 * gång till ger samma svar, så ett försök som hängde kan skickas igen utan
 * två skärmar eller två testhändelser.
 * ===========================================================================
 *
 * Före 0250 finns inte skärmarna, säljarnas val och testhändelserna. Då svarar
 * de handlingarna 503 med `FEL.inteInstallerad`, och `spara` går som vanligt:
 * `nav_setting` finns redan. Varje svar, också felen, går genom `svar()` och har
 * `Cache-Control: private, no-store, max-age=0`.
 */

type Db = ReturnType<typeof supabaseAdmin>;

/** Nyckeln i `nav_setting`. */
const NYCKEL = "salesboard";

/** Testhändelser äldre än så städas vid nästa insättning (spec §8). */
const DYGN_MS = 86_400_000;

/** Postgres: unikt värde finns redan. Här en ny rad i `nav_setting` som någon hann före med. */
const UNIK = "23505";

const nuIso = () => new Date().toISOString();

/**
 * Ett fel från databasen: 503 när `objekt` är en av 0250:s tabeller och den inte
 * finns än, annars 500. `objekt` null är en tabell som alltid finns.
 */
function dbFel(objekt: string | null, e: Dbfel, vad: string) {
  if (objekt && saknasAn(objekt, e)) return svar({ fel: FEL.inteInstallerad }, 503);
  console.error(`salesboard/skriv: ${vad}:`, e.message ?? e);
  return svar({ fel: FEL.ovantat }, 500);
}

/** Skärmarna efter en skrivning som redan lyckats. Går de inte att läsa följer ingen lista med, aldrig ett fel. */
async function skarmarEfter(db: Db) {
  const r = await lasSkarmar(db);
  if (r.lasning !== "svar") console.error("salesboard/skriv: skärmarna efter skrivningen:", r.fel?.code ?? "", r.fel?.message ?? r.lasning);
  return r.lasning === "svar" ? r.skarmar : undefined;
}

/** Vem som frågar, som ett läge (`atkomstsvar` avgör svaret). Kastar aldrig. */
async function vemFragar(): Promise<Atkomstlage> {
  try {
    const admin = await tavlansAdmin();
    if (admin?.employee) return { typ: "admin", id: admin.employee.id };
    // Ett säkert nej. Bara för att välja rätt: utan session ska klienten be om en inloggning.
    return { typ: "nej", session: (await getCurrentUser()) !== null };
  } catch (e) {
    console.error("salesboard/skriv: åtkomsten:", e instanceof Error ? e.message : e);
    return { typ: "oklart" };
  }
}

// -----------------------------------------------------------------------------
// Handlingarna
// -----------------------------------------------------------------------------

/**
 * Lägger delarna ovanpå det som gäller nu och sparar, om allt landade och ingen
 * annan hann emellan (R25). Ett nytt lag måste finnas, och då följer lagets
 * säljare och tröskel med i svaret, eller `personerInaktuella` när säljarna inte
 * gick att läsa om.
 */
async function spara(db: Db, delar: Delar, mig: string): Promise<Response> {
  if (delar.lag) {
    const { data: lag, error: lagfel } = await db.from("team").select("id").eq("id", delar.lag).maybeSingle();
    if (lagfel) return dbFel(null, lagfel, "laget");
    if (!lag) return svar({ fel: FEL.laget, del: "lag" }, 400);
  }

  for (let forsok = 1; ; forsok++) {
    const { data, error } = await db.from("nav_setting").select("value, updated_at").eq("key", NYCKEL).maybeSingle();
    if (error) return dbFel(null, error, "inställningarna");

    const plan = planeraSparning(data as Installningsrad, delar);
    if ("fel" in plan) return svar(plan, 400);

    // Stämpeln är alltid senare än den som lästes, så att två sparningar från samma läsning
    // aldrig båda kan landa, hur klockorna i två instanser än går.
    const rad = { value: plan.installningar, updated_by: mig, updated_at: nastaStampel(plan.villkor, nuIso()) };
    let landade: boolean;
    if (plan.villkor === null) {
      const { error: skrivfel } = await db.from("nav_setting").insert({ key: NYCKEL, ...rad });
      if (skrivfel && skrivfel.code !== UNIK) return dbFel(null, skrivfel, "sparningen");
      landade = !skrivfel;
    } else {
      const { data: skrivna, error: skrivfel } = await db
        .from("nav_setting")
        .update(rad)
        .eq("key", NYCKEL)
        .eq("updated_at", plan.villkor)
        .select("key");
      if (skrivfel) return dbFel(null, skrivfel, "sparningen");
      landade = (skrivna ?? []).length > 0;
    }

    const beslut = efterForsok(forsok, landade);
    if (beslut === "igen") continue;
    if (beslut === "krock") return svar({ fel: FEL.samtidigt }, 409);

    await skrivHandelse({ actorId: mig, action: HANDELSER.spara, objectType: "nav_setting", objectId: NYCKEL, meta: { delar } });
    if (!("lag" in delar)) return svar({ ok: "Sparat.", installningar: plan.installningar });

    const laget = await lasSaljareOchTroskel(db, plan.installningar.lag, []);
    return svar({
      ok: "Sparat.",
      installningar: plan.installningar,
      troskel: laget.troskel,
      ...(laget.personer ? { personer: laget.personer } : { personerInaktuella: true }),
    });
  }
}

/**
 * Parar en TV: skärmen skapas, och koden löses in med EN villkorad uppdatering
 * (koden finns, gäller och är inte redan inlöst). Löstes ingen rad in tas den
 * nya skärmen bort igen (`parningsutfall`), så att en felskriven eller utgången
 * kod aldrig lämnar en skärm efter sig. TV:n frågar var tredje sekund och hämtar
 * sin token när raden pekar på skärmen (`/salesboard/par`).
 */
async function para(db: Db, kod: string, namn: string, mig: string): Promise<Response> {
  const { data: ny, error } = await db.from("salesboard_screen").insert({ name: namn, created_by: mig }).select("id").single();
  if (error) return dbFel("salesboard_screen", error, "skärmen");
  const id = (ny as { id: string }).id;

  const { data: losta, error: losfel } = await db
    .from("salesboard_pairing")
    .update({ screen_id: id })
    .eq("code_hash", hasha(kod))
    .gt("expires_at", nuIso())
    .is("screen_id", null)
    .select("code_hash");

  const utfall = parningsutfall(losfel, (losta ?? []).length);
  if (utfall !== "klar") {
    const { error: stadfel } = await db.from("salesboard_screen").delete().eq("id", id);
    // Blir den kvar står den som "Väntar på TV:n" och går att koppla bort.
    if (stadfel) console.error("salesboard/skriv: skärmen utan kod blev kvar:", stadfel.message);
    return utfall === "fel" ? dbFel("salesboard_pairing", losfel as Dbfel, "koden") : svar({ fel: FEL.koden, del: "kod" }, 404);
  }

  await skrivHandelse({ actorId: mig, action: HANDELSER.para, objectType: "salesboard_screen", objectId: id, meta: { namn } });
  return svar({ ok: "Parad.", ny: id, skarmar: await skarmarEfter(db) });
}

/** Ändrar en skärm som inte kopplats bort. En bortkopplad eller okänd skärm ger 404. */
async function andraSkarm(
  db: Db,
  mig: string,
  id: string,
  andring: Record<string, unknown>,
  logg: { action: string; meta: Record<string, unknown> | null; ok: string },
): Promise<Response> {
  const { data, error } = await db.from("salesboard_screen").update(andring).eq("id", id).is("revoked_at", null).select("id");
  if (error) return dbFel("salesboard_screen", error, "skärmen");
  if (!data?.length) return svar({ fel: FEL.skarmen }, 404);

  await skrivHandelse({ actorId: mig, action: logg.action, objectType: "salesboard_screen", objectId: id, meta: logg.meta });
  return svar({ ok: logg.ok, skarmar: await skarmarEfter(db) });
}

/**
 * En säljares visning. Raden finns för varje säljare som någon gång valt något.
 * Bara visningen skrivs (R33): en sida som stått öppen i timmar kan inte skriva
 * över något annat än det admin just ändrade.
 */
async function person(db: Db, mig: string, s: Extract<Skrivning, { handling: "person" }>): Promise<Response> {
  const { error } = await db
    .from("salesboard_person")
    .upsert({ employee_id: s.id, display: s.display, updated_by: mig, updated_at: nuIso() }, { onConflict: "employee_id" });
  if (error) {
    // 23503 = främmande nyckel: ingen anställd med det id:t.
    if (error.code === "23503") return svar({ fel: FEL.saljaren, del: "id" }, 404);
    return dbFel("salesboard_person", error, "säljaren");
  }

  await skrivHandelse({ actorId: mig, action: HANDELSER.person, objectType: "employee", objectId: s.id, meta: { display: s.display } });
  return svar({ ok: "Sparat." });
}

/**
 * En testhändelse, `{typ}` i payloaden, som tavlan läser den. Ringklockan på
 * tabellen säger till skärmarna direkt. Händelser äldre än ett dygn städas
 * efteråt, och en städning som går fel stoppar inte testet.
 */
async function testa(db: Db, mig: string, typ: Extract<Skrivning, { handling: "testa" }>["typ"]): Promise<Response> {
  const { error } = await db.from("salesboard_event").insert({ kind: "test", payload: { typ }, created_by: mig });
  if (error) return dbFel("salesboard_event", error, "testet");

  const { error: stadfel } = await db.from("salesboard_event").delete().lt("created_at", new Date(Date.now() - DYGN_MS).toISOString());
  if (stadfel) console.error("salesboard/skriv: städningen av testhändelserna:", stadfel.message);
  return svar({ ok: "Skickat." });
}

async function utfor(s: Skrivning, mig: string): Promise<Response> {
  const db = supabaseAdmin();
  switch (s.handling) {
    case "spara":
      return spara(db, s.delar, mig);
    case "para":
      return para(db, s.kod, s.namn, mig);
    case "byt_namn":
      return andraSkarm(db, mig, s.id, { name: s.namn }, { action: HANDELSER.byt_namn, meta: { namn: s.namn }, ok: "Sparat." });
    case "ljud_skarm":
      return andraSkarm(db, mig, s.id, { sound: s.ljud }, { action: HANDELSER.ljud_skarm, meta: { ljud: s.ljud }, ok: "Sparat." });
    case "koppla_bort":
      // Tokenen nollas, så att kakan på TV:n inte släpper in något mer. Nästa hämtning får 401.
      return andraSkarm(
        db,
        mig,
        s.id,
        { revoked_at: nuIso(), revoked_by: mig, token_hash: null },
        { action: HANDELSER.koppla_bort, meta: null, ok: "Bortkopplad." },
      );
    case "person":
      return person(db, mig, s);
    case "testa":
      return testa(db, mig, s.typ);
  }
}

export async function POST(request: Request) {
  if (!sammaUrsprung(request)) return svar({ fel: FEL.ursprung }, 403);

  try {
    const vem = await vemFragar();
    const nej = atkomstsvar(vem);
    if (nej || vem.typ !== "admin") return svar({ fel: nej?.fel ?? FEL.ovantat }, nej?.status ?? 500);

    let kropp: unknown;
    try {
      kropp = await request.json();
    } catch {
      return svar({ fel: FEL.ogiltig }, 400);
    }
    const skrivning = tolkaSkrivning(kropp);
    if ("fel" in skrivning) return svar(skrivning, 400);

    return await medNyckel(request, vem.id, () => utfor(skrivning, vem.id));
  } catch (e) {
    console.error("salesboard/skriv:", e instanceof Error ? e.message : e);
    return svar({ fel: FEL.ovantat }, 500);
  }
}

/**
 * Skärmarna, för inställningssidans lista. Samma åtkomst som skrivningarna. `nu`
 * är serverns klocka, så att sidan räknar "sedd för …" på servertid.
 */
export async function GET() {
  try {
    const vem = await vemFragar();
    const nej = atkomstsvar(vem);
    if (nej) return svar({ fel: nej.fel }, nej.status);

    const r = await lasSkarmar(supabaseAdmin());
    if (r.lasning === "saknas") return svar({ fel: FEL.inteInstallerad }, 503);
    if (r.lasning === "fel") {
      console.error("salesboard/skriv: skärmarna:", r.fel?.message);
      return svar({ fel: FEL.svararInte }, 503);
    }
    return svar({ skarmar: r.skarmar, nu: nuIso() });
  } catch (e) {
    console.error("salesboard/skriv: skärmarna:", e instanceof Error ? e.message : e);
    return svar({ fel: FEL.ovantat }, 500);
  }
}
