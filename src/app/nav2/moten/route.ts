import { NextResponse, after } from "next/server";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svenskaMinuter, svensktDatum, svenskTidpunkt } from "@/lib/klocka";
import { SAMTAL_MIN_SEK, samtalsfonster, samtalTillatet } from "@/lib/nav2/motesstatforma";
import { notifiera } from "@/lib/notishandelse-server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { dagPlus } from "@/lib/saljtakt";
import { lk } from "@/lib/leveranskalender-server";
import { tomEfterFonstret } from "@/lib/utkorg-server";
import { flytta, hamtaUpptaget, skapaMote, stallIn } from "@/app/(app)/kalender/moten/actions";
import {
  MOTE_PLATS,
  TYST_EFTER_INGET_SVAR,
  andraIndata,
  andringForKund,
  arHallare,
  arSkrivning,
  efterBokning,
  bokaIndata,
  type BokaVarden,
  bolagsDoman,
  efterIngetSvar,
  efterUtfall,
  farAndraKedja,
  farKopplaOrder,
  farBekrafta,
  farRadera,
  farSattaUtfall,
  farSe,
  flyttaIndata,
  kedjaFore,
  kollegorIndata,
  kundIndata,
  MAX_GASTER,
  MAX_KOLLEGOR,
  ledigaTider,
  lokalTidpunkt,
  moteIndata,
  motesArt,
  nejIndata,
  paminnIndata,
  telefonE164,
  tolkaUppslag,
  upptagetTillIntervall,
  uppslagsVarning,
  videoNamn,
  utfallIndata,
  arEgenRubrik,
  moteRubrik,
  type Aktor,
  type UtfallIn,
  type Uppslag,
} from "@/lib/nav2/motenforma";
import { lokal } from "@/lib/nav2/leads";
import { medNyckel } from "@/lib/nav2/nyckel";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0, Möten: allt som ändrar eller frågar Möten, i en rutt.
 *
 * ===========================================================================
 * DEL 1 (A6): `uppslag`, `lediga`, `boka` och `paminn`.
 * DEL 2 (A7): mötets knappar `bekrafta`, `flytta`, `avboka`, `utfall`, `kund`, `nej`.
 *   `radera` (V6a): de som är med på ett öppet möte, eller en säljchef (också när mötet har utfall), raderar det. Allt i databasen i `mote_radera` (0268).
 *   Med på mötet (2026-11-04): bokaren, hållaren och kollegorna i kalenderhändelsen. Alla tre får göra samma saker (`arMedPaMote`).
 *   `andra` (2026-11-03): ändra ett öppet möte, bara de fält som skickas (se `andra`).
 * DEL 3 (A8): uppföljningen `inget_svar` och `prova_igen`.
 * `samtal` (B4): samtalen bakom statistikens tal, sina egna eller (chef) allas. En okänd handling svarar 400.
 *
 * SKRIVNING: bara service role skriver i Mötens tabeller (0260 har bara
 * select-policyer). Aktören är alltid den inloggade (`mig`), aldrig något ur
 * anropet. `mote_uppslag` (0262) körs däremot med den inloggades egen token,
 * eftersom funktionen läser `current_employee_id()`.
 *
 * MÖTET I KALENDERN: hållaren är organisatör (rubriken "Clicknet - <bolag>: Möte", 30
 * minuter, plats Telefon). Bokar man åt sig själv går det genom `skapaMote`; bokar
 * man åt en kollega läggs mötet som kollegan själv med `lk_skapa_mote` (se
 * `bokaAtKollega`), eftersom Kalenderns ombudsregel annars nekar. Hållaren måste
 * vara en aktiv säljare, teamledare eller säljchef.
 *
 * DUBBELKLICK: `boka` går genom `medNyckel` (samma nyckel = samma svar), och
 * databasen står för resten: `mote_ett_oppet` (högst ett öppet möte per kedja)
 * och `mote_kedja_en_oppen` (högst en öppen kedja per bolag) ger 23505, som här
 * blir 409 respektive "hämta den öppna kedjan i stället".
 *
 * TID: "idag" och klockan räknas i Europe/Stockholm (`svensktDatum`,
 * `svenskaMinuter`), så ett möte 00:30 är i dag även när servern går på UTC.
 *
 * VERSIONSVILLKOR (A7, A8): varje skrivning är villkorad på tillståndet den ändrar från, så att ett
 * dubbelklick räknas en gång. `bekrafta` på `bekraftat_nar is null`, `utfall`/`avboka` på `utfall is
 * null`, `flytta` på `utfall is null` och mötets nuvarande tid, `kund`/`nej` på kedjans `avslut is
 * null`, och `inget_svar`/`prova_igen` på `uppfoljning_andrad is not distinct from fore`. Ingen rad
 * ändrad = 409. Ordningen när en handling rör flera ställen, och vad som städas om något fallerar,
 * står vid `sattUtfall`.
 *
 * ÅTERSTÄLLNING: det som sparats på tavlan tas tillbaka om det som följer misslyckas (kalendern,
 * kedjan, ett ombokat möte). Kortet försvinner aldrig från tavlan: en öppen kedja utan öppet möte
 * visas alltid i Följ upp (`mote_kolumn`), så ett halvskrivet läge är synligt och går att rätta.
 *
 * LÄSLÄGE: står `SKRIVLAGE.moten` på false svarar skrivningarna (`arSkrivning`) 423 innan något görs;
 * `uppslag` och `lediga` läser bara och svarar som vanligt.
 * ===========================================================================
 */

type LaggVarden = Pick<BokaVarden, "namn" | "kontakt" | "epost" | "kalla" | "hallsAv" | "dag" | "start" | "langd" | "mal" | "nulage" | "foregaende" | "med" | "gaster" | "plats" | "lank">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FRAMAT_DAGAR = 14;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

/** "Anna", "Anna och Erik", "Anna, Erik och Lisa". */
const lista = (n: string[]) => (n.length < 2 ? n.join("") : `${n.slice(0, -1).join(", ")} och ${n[n.length - 1]}`);

/** "tis 21 okt 10:00" ur en tidpunkt, för svaret. */
function nar(d: Date | string): string {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(typeof d === "string" ? new Date(d) : d);
  const p = Object.fromEntries(s.map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${String(p.month).replace(".", "")} ${p.hour}:${p.minute}`;
}
const minuterAv = (kl: string) => Number(kl.slice(0, 2)) * 60 + Number(kl.slice(3, 5));
const forFor = (n: string) => (n || "").split(" ")[0];

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b?.handling ?? "");

  // Bara skrivningarna spärras i läsläge; `uppslag` och `lediga` läser och svarar alltid.
  if (arSkrivning(handling) && !SKRIVLAGE.moten) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  const db = supabaseAdmin();

  /** En anställd som kan hålla ett möte: finns, har inte slutat och är säljare, teamledare eller säljchef. Ger namnet. */
  const anstalld = async (id: string): Promise<string | null> => {
    if (!UUID.test(id)) return null;
    const { data } = await db
      .from("employee")
      .select("first_name, last_name, status, employee_role!employee_role_employee_id_fkey(role)")
      .eq("id", id)
      .maybeSingle();
    const p = data as unknown as { first_name: string; last_name: string; status: string; employee_role: { role: string }[] | null } | null;
    return p && p.status !== "offboarded" && arHallare((p.employee_role ?? []).map((r) => r.role)) ? fullName(p) : null;
  };

  /** `mote_uppslag` som den inloggade. Ett fel ger tomt svar: uppslaget är en hjälp och spärrar aldrig. */
  const slaUpp = async (telefon: string | null, doman: string | null, namn: string | null): Promise<Uppslag> => {
    try {
      const sb = await supabaseServer();
      const { data, error } = await sb.rpc("mote_uppslag", { p_telefon: telefon, p_doman: doman, p_namn: namn });
      return error ? tolkaUppslag(null) : tolkaUppslag(data);
    } catch {
      return tolkaUppslag(null);
    }
  };

  // Gemensamt för mötets knappar och uppföljningen (A7, A8). Före `switch`: `const` hissas inte.
  const aktorn: Aktor = { id: mig, roller: user.roles as string[] };
  const MOTE_FALT = "id, kedja_id, event_id, bokat_av, halls_av, mote_tid, langd_min, kalla, mal, nulage, bekraftat_nar, bekraftat_av, utfall, antal_flyttningar";
  type MoteRad = {
    id: string;
    kedja_id: string;
    event_id: string | null;
    bokat_av: string;
    halls_av: string;
    mote_tid: string;
    langd_min: number;
    kalla: string;
    mal: string | null;
    nulage: string | null;
    bekraftat_nar: string | null;
    bekraftat_av: string | null;
    utfall: string | null;
    antal_flyttningar: number;
    /** Kollegorna i kalenderhändelsen (läses av `hamtaMote`, står inte på mötesraden). */
    med: string[];
  };
  type KedjaRad = { id: string; bolag_id: string; deltagare: string[]; avslut: string | null; uppfoljning_andrad: string | null; inget_svar_i_rad: number };
  const KEDJA_FALT = "id, bolag_id, deltagare, avslut, uppfoljning_andrad, inget_svar_i_rad";

  const hamtaMote = async (id: string): Promise<MoteRad | null> => {
    const { data } = await db.from("mote").select(MOTE_FALT).eq("id", id).maybeSingle();
    const m = (data as unknown as Omit<MoteRad, "med"> | null) ?? null;
    if (!m) return null;
    if (!m.event_id) return { ...m, med: [] };
    const { data: a } = await db.from("calendar_attendee").select("employee_id").eq("event_id", m.event_id).not("employee_id", "is", null).limit(200);
    return { ...m, med: ((a ?? []) as { employee_id: string }[]).map((x) => x.employee_id) };
  };
  const hamtaKedja = async (id: string): Promise<KedjaRad | null> => {
    const { data } = await db.from("mote_kedja").select(KEDJA_FALT).eq("id", id).maybeSingle();
    return (data as unknown as KedjaRad | null) ?? null;
  };
  /** Namnet på den som har kortet: hållaren av kedjans senaste möte, annars första deltagaren. */
  const kortHavare = async (kedja: string, deltagare: string[]): Promise<string> => {
    const { data: sist } = await db.from("mote").select("halls_av").eq("kedja_id", kedja).order("bokat_nar", { ascending: false }).limit(1);
    const id = ((sist ?? []) as { halls_av: string }[])[0]?.halls_av ?? deltagare[0];
    if (!id) return "en kollega";
    const { data } = await db.from("employee").select("first_name, last_name").eq("id", id).maybeSingle();
    const p = data as { first_name: string; last_name: string } | null;
    return p ? fullName(p) : "en kollega";
  };
  /** De av id:na som är anställda och inte har slutat (Kalenderns `lk_aktiv` nekar annars hela mötet). */
  const aktiva = async (ids: string[]): Promise<string[]> => {
    if (!ids.length) return [];
    const { data } = await db.from("employee").select("id").in("id", ids).neq("status", "offboarded").limit(ids.length);
    const finns = new Set(((data ?? []) as { id: string }[]).map((x) => x.id));
    return ids.filter((id) => finns.has(id));
  };
  /** Förnamnen, i den ordning id:na kom, för kvittot. */
  const fornamnFor = async (ids: string[]): Promise<string[]> => {
    if (!ids.length) return [];
    const { data } = await db.from("employee").select("id, first_name").in("id", ids).limit(ids.length);
    const n = new Map(((data ?? []) as { id: string; first_name: string | null }[]).map((x) => [x.id, x.first_name ?? ""]));
    return ids.map((id) => n.get(id) || "en kollega");
  };

  const harOppetMote = async (kedja: string): Promise<boolean> => {
    const { data } = await db.from("mote").select("id").eq("kedja_id", kedja).is("utfall", null).limit(1);
    return ((data ?? []) as unknown[]).length > 0;
  };

  /** Kalenderhändelsen som hållaren: `lk_`-funktionen kräver att aktören får ändra organisatörens kalender. */
  const efterKalender = () => {
    try {
      after(tomEfterFonstret);
    } catch {
      // Ingen begäran att haka i. Utkorgsjobbet tar raderna inom en minut.
    }
  };
  /** Flytta mötets kalenderhändelse. Aktören är hållaren själv, eller `lk_flytta` körs som hållaren (som `bokaAtKollega`). */
  async function flyttaIKalender(m: MoteRad, dag: string, start: string): Promise<string | null> {
    if (!m.event_id) return null;
    if (m.halls_av === mig) {
      const r = await flytta(m.event_id, dag, minuterAv(start));
      return r.fel ?? null;
    }
    // Bara mötets egen händelse, och bara efter att `farSe` prövats på mötet.
    const r = await lk<{ undo_id: string }>("lk_flytta", { p_aktor: m.halls_av, p_event: m.event_id, p_dag: dag, p_tid: `${start}:00`, p_minuter: null });
    if (!r.ok) return r.fel;
    efterKalender();
    return null;
  }
  async function stallInIKalender(m: MoteRad): Promise<string | null> {
    if (!m.event_id) return null;
    if (m.halls_av === mig) {
      const r = await stallIn(m.event_id);
      return r.fel ?? null;
    }
    const r = await lk<{ undo_id: string }>("lk_stall_in", { p_aktor: m.halls_av, p_event: m.event_id });
    if (!r.ok) return r.fel;
    efterKalender();
    return null;
  }

  /** Tar tillbaka ett utfall vi nyss satte (villkorat på exakt den tid vi satte det). Ger false om det inte gick. */
  async function angraUtfall(moteId: string, utfallNar: string): Promise<boolean> {
    const { data, error } = await db
      .from("mote")
      .update({ utfall: null, utfall_nar: null, utfall_av: null, resultat: null, resultat_nar: null, resultat_av: null, nej_skal: null })
      .eq("id", moteId)
      .eq("utfall_nar", utfallNar)
      .select("id");
    return !error && ((data ?? []) as unknown[]).length > 0;
  }
  const HALVSKRIVET = "Mötet sparades inte helt. Kortet ligger kvar i Följ upp. Ladda om tavlan och försök igen.";

  switch (handling) {
    case "uppslag": {
      const telefon = telefonE164(typeof b.telefon === "string" ? b.telefon : null);
      const doman = bolagsDoman(typeof b.doman === "string" ? b.doman : null);
      const namn = typeof b.namn === "string" && b.namn.trim() ? b.namn.trim().slice(0, 200) : null;
      const u = await slaUpp(telefon, doman, namn);
      return svar({ ok: "Uppslag.", ...u, varning: uppslagsVarning(u, nar) });
    }

    case "lediga": {
      const hallsAv = String(b.hallsAv ?? "");
      if (!(await anstalld(hallsAv))) return svar({ fel: "Den som ska hålla mötet finns inte, har slutat eller är ingen säljare." }, 400);
      const nu = new Date();
      const idag = svensktDatum(nu);
      const till = dagPlus(idag, FRAMAT_DAGAR);
      // Med kollegor: tiderna då alla är lediga (som Kalenderns Föreslå en tid), och var och ens upptagna tid
      // så att en egen tid kan säga vem den krockar med. Bara block, inga rubriker.
      const med = kollegorIndata(b.med, hallsAv);
      if (!med.ok) return svar({ fel: med.fel }, 400);
      const alla = [hallsAv, ...med.varden];
      const upptaget = await hamtaUpptaget(alla, idag, till);
      const per = Object.fromEntries(alla.map((id) => [id, upptagetTillIntervall(upptaget[id])]));
      const tider = ledigaTider(alla.flatMap((id) => per[id]), idag, lokalTidpunkt(idag, svenskaMinuter(nu)))
        // Kalendern vet inget om dagarna efter `till`; de skulle se lediga ut.
        .filter((t) => t.dag <= till);
      return svar({ ok: "Lediga tider.", idag, till, tider, upptaget: per });
    }

    case "boka":
      return await medNyckel(request, mig, () => boka());

    case "paminn":
      return await medNyckel(request, mig, () => paminn());

    case "bekrafta":
      return await bekrafta();

    case "flytta":
      return await flyttaMote();

    case "avboka":
      return await utfallHandling(true);

    case "utfall":
      return await utfallHandling(false);

    case "radera":
      return await radera();

    case "andra":
      return await medNyckel(request, mig, () => andra());

    case "kund":
      return await kund();

    case "nej":
      return await nej();

    case "inget_svar":
      return await uppfoljning("inget_svar");

    case "prova_igen":
      return await uppfoljning("prova_igen");

    case "samtal": {
      // B4/varv 2: samtalen bakom statistikens tal Samtal, bara de på minst SAMTAL_MIN_SEK (varv 3, 0267). Samma krets som mote_samtal_vecka (0264): mote_statkrets()
      // anropas som den inloggade, null = alla (säljchef, vd, admin), en teamledare får sitt team, övriga sig själva.
      const person = String(b.person ?? "");
      if (!UUID.test(person)) return svar({ fel: "Ogiltig begäran." }, 400);
      // Datumen (omöjliga datum ger 400, inte 500), fönstret [fran, slut) och `fore` valideras på ett ställe.
      const fonster = samtalsfonster({ fran: b.fran, till: b.till, fore: b.fore });
      if ("fel" in fonster) return svar({ fel: fonster.fel }, 400);
      // `undefined` = rpc:n felade eller svaret hade fel format. samtalTillatet() ger 500 också när `null` kommer
      // till någon som inte är sales_manager, ceo eller admin (aktörens roller), så ett tyst null blir aldrig "alla".
      let krets: string[] | null | undefined;
      try {
        const sb = await supabaseServer();
        const { data, error } = await sb.rpc("mote_statkrets");
        krets = error || !(data === null || (Array.isArray(data) && data.every((x) => typeof x === "string"))) ? undefined : (data as string[] | null);
      } catch {
        krets = undefined;
      }
      const tillatet = samtalTillatet(krets, aktorn.roller, person);
      if (!("ok" in tillatet)) return svar({ fel: tillatet.fel }, tillatet.status);
      const MAX_SAMTAL = 1000;
      // Fönstret är [fran, slut): slut är nästa dygns 00:00 svensk tid, som 0263:s `< p_till + 1`. `fore` är
      // tidpunkten då statistikens tal lästes; Lynes skriver in samtalet först när det är slut (created_at),
      // så samtal som kom efter talen ska inte stå i listan under dem.
      let fraga = db
        .from("phone_call")
        .select("started_at, counterpart_e164, duration_seconds")
        .eq("employee_id", person)
        .eq("direction", "ut")
        .gte("duration_seconds", SAMTAL_MIN_SEK)
        .gte("started_at", fonster.fran)
        .lt("started_at", fonster.slut);
      if (fonster.fore) fraga = fraga.lte("created_at", fonster.fore);
      const { data, error } = await fraga.order("started_at", { ascending: false }).limit(MAX_SAMTAL);
      if (error) return svar({ fel: "Samtalen gick inte att läsa." }, 500);
      const rader = (data ?? []) as { started_at: string; counterpart_e164: string | null; duration_seconds: number | null }[];
      return svar({
        ok: "Samtal.",
        samtal: rader.map((r) => ({ tid: nar(r.started_at), nummer: r.counterpart_e164, sek: r.duration_seconds })),
        kapat: rader.length === MAX_SAMTAL,
      });
    }

    default:
      return svar({ fel: "Okänd handling." }, 400);
  }

  async function boka(): Promise<Response> {
    const r = bokaIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const v = r.varden;
    if (!(await anstalld(v.hallsAv))) return svar({ fel: "Den som ska hålla mötet finns inte, har slutat eller är ingen säljare." }, 400);
    if ((await aktiva(v.med)).length !== v.med.length) return svar({ fel: "En av kollegorna finns inte längre i Nav. Ta bort namnet och försök igen." }, 400);
    const motetid = svenskTidpunkt(v.dag, v.start);
    if (!Number.isFinite(motetid.getTime())) return svar({ fel: "Välj en starttid." }, 400);
    const varningar: string[] = [];

    // Uppslaget först, innan något skapats: ett träff här är ett ANNAT bokat möte eller en kund.
    const upp = await slaUpp(v.telefon, v.doman, v.namn);
    const uppVarning = uppslagsVarning(upp, nar);
    if (uppVarning) varningar.push(uppVarning);

    // 2. Bolaget på telefon, annars skapa det.
    const { data: bolagRader, error: bolagFel } = await db.from("mote_bolag").select("id").eq("telefon", v.telefon).order("skapad").limit(10);
    if (bolagFel) return svar({ fel: "Bolaget kunde inte läsas." }, 500);
    const bolagIds = ((bolagRader ?? []) as { id: string }[]).map((x) => x.id);

    // 3. Kedjan: den som anges (om den hör till bolaget och är öppen), bolagets öppna, annars en ny.
    let kedjaId: string | null = null;
    let bolagId: string | null = null;
    let skapadBolag = false;
    let skapadKedja = false;

    if (v.kedja) {
      const { data } = await db.from("mote_kedja").select("id, bolag_id, avslut, deltagare").eq("id", v.kedja).maybeSingle();
      const k = data as { id: string; bolag_id: string; avslut: string | null; deltagare: string[] } | null;
      if (!k) return svar({ fel: "Kedjan finns inte." }, 404);
      // Rätten prövas innan något skrivs: bokaren hamnar i `deltagare` (och får läsrätt) när mötet läggs.
      if (!farAndraKedja(aktorn, k.deltagare)) return svar({ fel: "Du har inte tillgång till det här kortet." }, 403);
      if (k.avslut) return svar({ fel: "Kedjan är redan avslutad." }, 409);
      if (!bolagIds.includes(k.bolag_id)) return svar({ fel: "Kedjan hör till ett annat bolag." }, 400);
      kedjaId = k.id;
      bolagId = k.bolag_id;
    } else if (bolagIds.length) {
      const { data } = await db.from("mote_kedja").select("id, bolag_id, deltagare").in("bolag_id", bolagIds).is("avslut", null).limit(1);
      const k = ((data ?? []) as { id: string; bolag_id: string; deltagare: string[] }[])[0];
      if (k) {
        // Ett kort per bolag. Är bokaren inte med i kedjan (och inte chef) läggs hen inte till tyst: 409 med namnet på den som har kortet.
        if (!farAndraKedja(aktorn, k.deltagare)) {
          const hos = await kortHavare(k.id, k.deltagare);
          return svar({ fel: `Bolaget har redan ett öppet kort hos ${hos}.` }, 409);
        }
        kedjaId = k.id;
        bolagId = k.bolag_id;
        varningar.push("Bolaget fanns redan på tavlan. Mötet lades i dess kedja.");
      } else {
        bolagId = bolagIds[0];
      }
    }

    if (!bolagId) {
      const { data, error } = await db
        .from("mote_bolag")
        .insert({ namn: v.namn, kontakt: v.kontakt, telefon: v.telefon, epost: v.epost, doman: v.doman, kalla: v.kalla, skapad_av: mig })
        .select("id")
        .single();
      if (error || !data) return svar({ fel: "Bolaget kunde inte sparas." }, 500);
      bolagId = (data as { id: string }).id;
      skapadBolag = true;
    }

    if (!kedjaId) {
      const { data, error } = await db.from("mote_kedja").insert({ bolag_id: bolagId }).select("id").single();
      if (!error && data) {
        kedjaId = (data as { id: string }).id;
        skapadKedja = true;
      } else if (error?.code === "23505") {
        // Dubbelklick: en annan begäran hann skapa bolagets öppna kedja. Använd den.
        const { data: k } = await db.from("mote_kedja").select("id").eq("bolag_id", bolagId).is("avslut", null).limit(1);
        kedjaId = ((k ?? []) as { id: string }[])[0]?.id ?? null;
        if (kedjaId) varningar.push("Bolaget fanns redan på tavlan. Mötet lades i dess kedja.");
      }
      if (!kedjaId) {
        if (skapadBolag) await db.from("mote_bolag").delete().eq("id", bolagId);
        return svar({ fel: "Kedjan kunde inte skapas." }, 500);
      }
    }
    const kedja = kedjaId;
    const bolag = bolagId;

    /** Tillbaka som det var: det vi skapade i det här anropet, ingenting annat. */
    const stada = async () => {
      if (skapadBolag) await db.from("mote_bolag").delete().eq("id", bolag);
      else if (skapadKedja) await db.from("mote_kedja").delete().eq("id", kedja);
    };

    return (await laggMote({ kedja, bolag, v, motetid, varningar, skapadBolag, skapadKedja, stada })).res;
  }

  /**
   * Steg 4–9 i `boka`: mötesraden, kalenderhändelsen, inbjudan, loggen och notisen. Också vägen för ett
   * ombokat möte efter Uteblev (A7), så båda går genom samma kontroller (ett öppet möte per kedja,
   * kalendern, kopplingen). `kvar` är mötesraden när den finns kvar efter svaret, annars null; den som
   * anropar vet därmed om något nytt möte finns att ta hänsyn till när den städar.
   */
  async function laggMote(i: {
    kedja: string;
    bolag: string;
    v: LaggVarden;
    motetid: Date;
    varningar: string[];
    skapadBolag: boolean;
    skapadKedja: boolean;
    stada: () => Promise<void>;
  }): Promise<{ res: Response; kvar: string | null }> {
    const { kedja, bolag, v, motetid, varningar, skapadBolag, skapadKedja, stada } = i;
    const ut = (data: Svar, status = 200) => ({ res: svar(data, status), kvar: null });
    // 4. Art: hållet möte i kedjan = uppföljning, annars ombokning om det finns ett föregående.
    if (v.foregaende) {
      const { data } = await db.from("mote").select("id").eq("id", v.foregaende).eq("kedja_id", kedja).maybeSingle();
      if (!data) {
        await stada();
        return ut({ fel: "Det tidigare mötet hör inte till kedjan." }, 400);
      }
    }
    const { data: hallna } = await db.from("mote").select("id").eq("kedja_id", kedja).eq("utfall", "hallet").limit(1);
    const art = motesArt(((hallna ?? []) as unknown[]).length > 0, v.foregaende);

    // 5. Mötesraden, villkorad på att kedjan inte har något öppet möte (unika indexet mote_ett_oppet).
    const { data: oppet } = await db.from("mote").select("id").eq("kedja_id", kedja).is("utfall", null).limit(1);
    if (((oppet ?? []) as unknown[]).length > 0) {
      await stada();
      return ut({ fel: "Bolaget har redan ett bokat möte." }, 409);
    }
    const { data: ins, error: insFel } = await db
      .from("mote")
      .insert({
        kedja_id: kedja,
        bokat_av: mig,
        halls_av: v.hallsAv,
        mote_tid: motetid.toISOString(),
        langd_min: v.langd,
        kalla: v.kalla,
        art,
        foregaende_id: v.foregaende,
        mal: v.mal,
        nulage: v.nulage,
      })
      .select("id")
      .single();
    if (insFel || !ins) {
      await stada();
      if (insFel?.code === "23505") return ut({ fel: "Bolaget har redan ett bokat möte." }, 409);
      return ut({ fel: "Mötet kunde inte sparas." }, 500);
    }
    const moteId = (ins as { id: string }).id;

    // 6. Mötet i Kalendern, med hållaren som organisatör. Misslyckas det tas mötesraden bort.
    //
    // Bokning åt en kollega (beslut i HANDOFF, Möten): `skapaMote` kör som den inloggade, och Kalenderns
    // `lk_far_andra` släpper bara in den som är organisatör eller har ombud i hållarens kalender. Här
    // bokar en säljare åt en annan, så mötet läggs som hållaren själv (`p_aktor = p_organizer = hallsAv`,
    // `lk_skapa_mote`, 0069) med service role. Bokaren står kvar i `mote.bokat_av`, notisen `mote-bokat`
    // går till hållaren (steg 9), och `hallsAv` är redan prövad som en aktiv säljare, så ingen annans
    // kalender kan fyllas med möten.
    const rubrik = moteRubrik(v.namn);
    const m: { fel?: string; eventId?: string } =
      v.hallsAv === mig
        ? await skapaMote({ organisator: v.hallsAv, rubrik, dag: v.dag, start: minuterAv(v.start), minuter: v.langd, deltagare: [v.hallsAv, ...v.med], plats: v.plats, agenda: v.mal })
        : await bokaAtKollega({ hallsAv: v.hallsAv, med: v.med, rubrik, dag: v.dag, start: v.start, minuter: v.langd, agenda: v.mal, plats: v.plats, lank: v.lank });
    if (m.fel || !m.eventId) {
      await db.from("mote").delete().eq("id", moteId);
      await stada();
      return ut({ fel: m.fel ?? "Mötet kunde inte bokas i kalendern." }, 400);
    }

    // 6b. Teams-länken på händelsen innan någon bjuds in (`skapaMote` tar ingen länk; `bokaAtKollega` har redan skrivit den).
    // Inbjudan läser länken när den skickas, efter ångerfönstret, så kunden får den i första mejlet.
    if (v.lank && v.hallsAv === mig) {
      const { error } = await db.from("calendar_event").update({ online_url: v.lank }).eq("id", m.eventId);
      if (error) varningar.push("Teams-länken kom inte med i kalendern. Lägg till den under Ändra.");
    }
    if (v.plats === videoNamn(null) && !v.lank) varningar.push("Teams-länken saknas. Lägg till den under Ändra, så får kunden den med mejl.");

    // 7. Kopplingen till kalenderhändelsen. Mötet finns nu, så ett fel härifrån blir ett svar och inget kast.
    const { error: kopp } = await db.from("mote").update({ event_id: m.eventId }).eq("id", moteId);
    if (kopp) {
      return { res: svar({ fel: `Mötet ligger i kalendern ${nar(motetid)}, men kunde inte kopplas till tavlan (${kopp.message}). Ställ in det i kalendern om det ska bort.` }, 500), kvar: moteId };
    }

    // 7b. Kedjan fanns redan: Inget svar-räknaren börjar om och versionen flyttas fram (`efterBokning`).
    if (!skapadKedja) {
      const { error: nollFel } = await db.from("mote_kedja").update(efterBokning(new Date().toISOString())).eq("id", kedja).is("avslut", null);
      if (nollFel) varningar.push("Inget svar-räknaren kunde inte nollställas.");
    }

    // 8. Kunden som gäst, om vi har en e-postadress: Kalenderns inbjudan via Resend (som Leads).
    let bjuden = false;
    if (v.epost) {
      const { error } = await db.rpc("lead_bjud_in", { p_event: m.eventId, p_epost: v.epost });
      bjuden = !error;
    }
    // Fler hos kunden: samma inbjudan till var och en. Flyttas eller ställs mötet in får alla en uppdatering (calendar_event_ics).
    const gastFel: string[] = [];
    for (const g of v.gaster) {
      const { error } = await db.rpc("lead_bjud_in", { p_event: m.eventId, p_epost: g });
      if (error) gastFel.push(g);
    }

    await skrivHandelse({
      actorId: mig,
      action: "mote.created",
      objectType: "mote",
      objectId: moteId,
      meta: { kedja, bolag, halls_av: v.hallsAv, art, bolag_skapat: skapadBolag, kedja_skapad: skapadKedja, mote_tid: motetid.toISOString(), med: v.med, gaster: v.gaster.length },
    });

    // 9. Notis till den som ska hålla mötet, om någon annan bokade det.
    if (v.hallsAv !== mig) {
      await notifiera({
        till: v.hallsAv,
        av: mig,
        kalla: "mote-bokat",
        typ: "kalender",
        rubrik: `${forFor(fullName(user!.employee!))} bokade ett möte åt dig`,
        detalj: `${v.namn} · ${nar(motetid)}`,
        href: `/moten/${moteId}`,
      objekt: { typ: "mote", id: moteId },
      });
    }

    const kontakt = forFor(v.kontakt ?? "") || "Kunden";
    const gastOk = v.gaster.length - gastFel.length;
    const kunden = v.epost && bjuden
      ? `${gastOk ? `${forFor(v.kontakt ?? "") || v.epost} och ${gastOk} till hos kunden` : kontakt} får en inbjudan med mejl.`
      : gastOk ? `${gastOk === 1 ? v.gaster.find((g) => !gastFel.includes(g)) : `${gastOk} hos kunden`} får en inbjudan med mejl.` : "";
    const missade = [...(v.epost && !bjuden ? [kontakt] : []), ...gastFel];
    const inbjudan = [
      v.med.length ? `${lista(await fornamnFor(v.med))} får en inbjudan i Nav.` : "",
      kunden,
      missade.length ? `Inbjudan till ${lista(missade)} kunde inte skickas. Bjud in från kalendern.` : "",
    ].filter(Boolean).join(" ");
    return { res: svar({
      ok: `Mötet ligger i kalendern ${nar(motetid)}. ${inbjudan}`.trim(),
      mote: moteId,
      kedja,
      bolag,
      event: m.eventId,
      art,
      ...(varningar.length ? { varning: varningar.join(" ") } : {}),
    }), kvar: moteId };
  }

  /** `lk_skapa_mote` som hållaren själv. Samma argument som `skapaMote`, påminnelse 10 minuter, och Teams-länken. */
  async function bokaAtKollega(i: { hallsAv: string; med: string[]; rubrik: string; dag: string; start: string; minuter: number; agenda: string | null; plats: string; lank: string | null }): Promise<{ fel?: string; eventId?: string }> {
    const svar = await lk<{ event_id: string }>("lk_skapa_mote", {
      p_aktor: i.hallsAv,
      p_organizer: i.hallsAv,
      p_title: i.rubrik,
      p_dag: i.dag,
      p_tid: `${i.start}:00`,
      p_minuter: i.minuter,
      p_deltagare: [i.hallsAv, ...i.med],
      p_plats: i.plats,
      p_online_url: i.lank,
      p_agenda: (i.agenda ?? "").slice(0, 4000),
      p_reminder_min: 10,
    });
    if (!svar.ok) return { fel: svar.fel };
    try {
      after(tomEfterFonstret);
    } catch {
      // Ingen begäran att haka i. Utkorgsjobbet tar raderna inom en minut.
    }
    return { eventId: svar.data.event_id };
  }

  async function paminn(): Promise<Response> {
    const r = paminnIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const v = r.varden;
    // Bara en händelse i min egen kalender. Ingen rad i Mötens tabeller.
    const m = await skapaMote({
      organisator: mig,
      rubrik: `Ring ${v.namn} ${v.telefon}`,
      dag: v.dag,
      start: minuterAv(v.start),
      minuter: 15,
      deltagare: [mig],
      plats: null,
    });
    if (m.fel || !m.eventId) return svar({ fel: m.fel ?? "Påminnelsen kunde inte läggas i kalendern." }, 400);
    await skrivHandelse({ actorId: mig, action: "mote.reminder_created", objectType: "calendar_event", objectId: m.eventId, meta: { dag: v.dag, start: v.start } });
    return svar({ ok: `Påminnelsen ligger i kalendern ${nar(svenskTidpunkt(v.dag, v.start))}.`, event: m.eventId });
  }

  // ===========================================================================
  // A7, mötets knappar
  // ===========================================================================

  /** Hämtar mötet och prövar att aktören får se det. */
  async function moteForSe(id: string): Promise<{ m: MoteRad } | { res: Response }> {
    const m = await hamtaMote(id);
    if (!m) return { res: svar({ fel: "Mötet finns inte." }, 404) };
    if (!farSe(aktorn, m)) return { res: svar({ fel: "Du har inte tillgång till det här mötet." }, 403) };
    return { m };
  }

  async function bekrafta(): Promise<Response> {
    const r = moteIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const h = await moteForSe(r.varden.mote);
    if ("res" in h) return h.res;
    const m = h.m;
    if (!farBekrafta(aktorn, m)) return svar({ fel: "Du har inte tillgång till det här mötet." }, 403);
    if (m.utfall) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
    const { data, error } = await db
      .from("mote")
      .update({ bekraftat_nar: new Date().toISOString(), bekraftat_av: mig })
      .eq("id", m.id)
      .is("bekraftat_nar", null)
      .is("utfall", null)
      .select("id");
    if (error) return svar({ fel: "Bekräftelsen kunde inte sparas." }, 500);
    if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Mötet är redan bekräftat." }, 409);
    await skrivHandelse({ actorId: mig, action: "mote.confirmed", objectType: "mote", objectId: m.id, meta: { kedja: m.kedja_id } });
    return svar({ ok: "Mötet är bekräftat.", mote: m.id });
  }

  async function flyttaMote(): Promise<Response> {
    const r = flyttaIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const h = await moteForSe(r.varden.mote);
    if ("res" in h) return h.res;
    const m = h.m;
    if (m.utfall) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
    const ny = svenskTidpunkt(r.varden.dag, r.varden.start);
    if (!Number.isFinite(ny.getTime())) return svar({ fel: "Välj en starttid." }, 400);
    if (ny.getTime() === new Date(m.mote_tid).getTime()) return svar({ fel: "Mötet ligger redan då." }, 400);

    // Flytten nollställer Bekräftat: den nya tiden är inte bekräftad, så mötet står i Bokat igen.
    // Först tavlan, villkorad på mötets nuvarande tid och att utfall saknas: ett dubbelklick eller en
    // flytt som någon annan hunnit göra ger 0 rader. Sedan kalendern; fallerar den tas tiden tillbaka.
    const { data, error } = await db
      .from("mote")
      .update({ mote_tid: ny.toISOString(), antal_flyttningar: m.antal_flyttningar + 1, bekraftat_nar: null, bekraftat_av: null })
      .eq("id", m.id)
      .is("utfall", null)
      .eq("mote_tid", m.mote_tid)
      .select("id");
    if (error) return svar({ fel: "Flytten kunde inte sparas." }, 500);
    if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Mötet har ändrats. Ladda om tavlan." }, 409);

    const kalFel = await flyttaIKalender(m, r.varden.dag, r.varden.start);
    if (kalFel) {
      const { data: tillbaka } = await db
        .from("mote")
        .update({ mote_tid: m.mote_tid, antal_flyttningar: m.antal_flyttningar, bekraftat_nar: m.bekraftat_nar, bekraftat_av: m.bekraftat_av })
        .eq("id", m.id)
        .eq("mote_tid", ny.toISOString())
        .select("id");
      if (((tillbaka ?? []) as unknown[]).length === 0) {
        return svar({ fel: `Kalendern tog inte emot flytten (${kalFel}) och tavlan kunde inte tas tillbaka. Kolla mötets tid i kalendern.` }, 500);
      }
      return svar({ fel: kalFel }, 400);
    }
    await skrivHandelse({
      actorId: mig,
      action: "mote.moved",
      objectType: "mote",
      objectId: m.id,
      meta: { kedja: m.kedja_id, fran: m.mote_tid, till: ny.toISOString(), antal_flyttningar: m.antal_flyttningar + 1 },
    });
    return svar({ ok: `Mötet är flyttat till ${nar(ny)}.`, mote: m.id, mote_tid: ny.toISOString(), ...(m.event_id ? {} : { varning: "Mötet saknar kalenderhändelse. Kalendern är orörd." }) });
  }

  /**
   * `utfall` och `avboka`: mötets utfall, kedjans ändring och ett eventuellt nytt möte.
   *
   * ORDNING (och vad som städas):
   *  1. Mötet: `utfall`, `utfall_nar`, `utfall_av` (och `resultat*`) villkorat på `utfall is null`. Det är
   *     dubbelklicksvillkoret och sätts först: bara en av två samtidiga begäranden får fortsätta.
   *  2. Kedjan, villkorad på `avslut is null`. Fallerar den tas mötets utfall tillbaka (`angraUtfall`).
   *  3. Ett ombokat möte (Uteblev med ny tid) genom `laggMote`. Fallerar det, och inget nytt möte finns,
   *     tas utfallet tillbaka. Kedjan är då orörd.
   *  4. Avbokat: kalenderhändelsen ställs in sist. Misslyckas det är tavlan ändå rätt (mötet är avbokat),
   *     så svaret är ok med en varning, och kalendern får ställas in för hand.
   *
   * Går en återställning själv fel ligger mötet med utfall men kedjan öppen utan öppet möte, och
   * då visar `mote_kolumn` den i Följ upp. Kortet tappas aldrig.
   */
  async function utfallHandling(avboka: boolean): Promise<Response> {
    let mote: string;
    let inn: UtfallIn;
    if (avboka) {
      const r = moteIndata(b);
      if (!r.ok) return svar({ fel: r.fel }, 400);
      mote = r.varden.mote;
      inn = { utfall: "avbokat" };
    } else {
      const r = utfallIndata(b);
      if (!r.ok) return svar({ fel: r.fel }, 400);
      mote = r.varden.mote;
      inn = r.varden.inn;
    }
    const h = await moteForSe(mote);
    if ("res" in h) return h.res;
    const m = h.m;
    // Avboka kräver bara `farSe` (prövat ovan); ett utfall, också Avbokat som utfall, kräver `farSattaUtfall`.
    if (!avboka && !farSattaUtfall(aktorn, m)) return svar({ fel: "Bara de som är med på mötet eller en säljchef sätter utfallet." }, 403);
    if (m.utfall) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);

    const kedja = await hamtaKedja(m.kedja_id);
    if (!kedja) return svar({ fel: "Kedjan finns inte." }, 404);
    if (kedja.avslut) return svar({ fel: "Kedjan är redan avslutad." }, 409);
    const { data: hallna } = await db.from("mote").select("id").eq("kedja_id", m.kedja_id).eq("utfall", "hallet").limit(1);

    const nu = new Date();
    const nuIso = nu.toISOString();
    let a: ReturnType<typeof efterUtfall>;
    try {
      a = efterUtfall(inn, svensktDatum(nu), ((hallna ?? []) as unknown[]).length > 0, nuIso);
    } catch (e) {
      return svar({ fel: e instanceof Error ? e.message : "Utfallet stämmer inte." }, 400);
    }

    // Ett ombokat möte prövas innan något sparas.
    let nyTid: Date | null = null;
    if (a.nyttMote) {
      if (!(await anstalld(m.halls_av))) return svar({ fel: "Den som höll mötet kan inte hålla ett nytt." }, 400);
      nyTid = svenskTidpunkt(a.nyttMote.dag, a.nyttMote.start);
      if (!Number.isFinite(nyTid.getTime())) return svar({ fel: "Välj en starttid." }, 400);
    }

    // 1. Mötet.
    const moteLapp: Record<string, unknown> = { ...a.mote, utfall_nar: nuIso, utfall_av: mig };
    if (a.mote.resultat) {
      moteLapp.resultat_nar = nuIso;
      moteLapp.resultat_av = mig;
    }
    {
      const { data, error } = await db.from("mote").update(moteLapp).eq("id", m.id).is("utfall", null).select("id");
      if (error) return svar({ fel: "Utfallet kunde inte sparas." }, 500);
      if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
    }

    // 2. Kedjan.
    if (a.kedja) {
      const lapp: Record<string, unknown> = { ...a.kedja };
      if ("avslut" in lapp) {
        lapp.avslut_nar = nuIso;
        lapp.avslut_av = mig;
      }
      if ("uppfoljning_datum" in lapp) lapp.uppfoljning_andrad = nuIso;
      const { data, error } = await db.from("mote_kedja").update(lapp).eq("id", m.kedja_id).is("avslut", null).select("id");
      if (error || ((data ?? []) as unknown[]).length === 0) {
        const tillbaka = await angraUtfall(m.id, nuIso);
        if (!tillbaka) return svar({ fel: HALVSKRIVET }, 500);
        return error ? svar({ fel: "Utfallet kunde inte sparas." }, 500) : svar({ fel: "Kedjan är redan avslutad." }, 409);
      }
    }

    // 3. Ett ombokat möte: samma bokningsväg som `boka`, med hållaren och föregående möte satta.
    let bokat = "";
    let bokatVarning: string | null = null;
    let nyttMoteId: string | null = null;
    if (a.nyttMote && nyTid) {
      const { data: bolagRad } = await db.from("mote_bolag").select("id, namn, kontakt, epost").eq("id", kedja.bolag_id).maybeSingle();
      const bo = bolagRad as { id: string; namn: string; kontakt: string | null; epost: string | null } | null;
      // Samma personer som på mötet som uteblev: kollegorna som fortfarande är anställda, och gästerna hos kunden.
      const { data: narvaro } = m.event_id
        ? await db.from("calendar_attendee").select("employee_id, external_email").eq("event_id", m.event_id).limit(100)
        : { data: [] };
      const forra = (narvaro ?? []) as { employee_id: string | null; external_email: string | null }[];
      // Och samma plats: telefon, Teams-länken eller adressen.
      const { data: evRad } = m.event_id ? await db.from("calendar_event").select("plats, online_url").eq("id", m.event_id).maybeSingle() : { data: null };
      const ev = evRad as { plats: string | null; online_url: string | null } | null;
      const med = await aktiva([...new Set(forra.map((x) => x.employee_id).filter((x): x is string => !!x && x !== m.halls_av))].slice(0, MAX_KOLLEGOR));
      const kundEpost = (bo?.epost ?? "").toLowerCase();
      const gaster = [...new Set(forra.map((x) => (x.external_email ?? "").toLowerCase()).filter((x) => x && x !== kundEpost))].slice(0, MAX_GASTER);
      let lagt: { res: Response; kvar: string | null } | null = null;
      if (bo) {
        lagt = await laggMote({
          kedja: m.kedja_id,
          bolag: bo.id,
          v: { namn: bo.namn, kontakt: bo.kontakt, epost: bo.epost, kalla: m.kalla, hallsAv: m.halls_av, dag: a.nyttMote.dag, start: a.nyttMote.start, langd: m.langd_min, mal: m.mal, nulage: m.nulage as LaggVarden["nulage"], foregaende: m.id, med, gaster, plats: ev?.plats || MOTE_PLATS, lank: ev?.online_url ?? null },
          motetid: nyTid,
          varningar: [],
          skapadBolag: false,
          skapadKedja: false,
          stada: async () => {},
        });
      }
      if (!lagt || !lagt.res.ok) {
        if (lagt?.kvar) {
          // Det nya mötet finns kvar (bara kopplingen till kalendern fallerade): utfallet står kvar.
          return lagt.res;
        }
        const tillbaka = await angraUtfall(m.id, nuIso);
        if (!tillbaka) return svar({ fel: HALVSKRIVET }, 500);
        return lagt ? lagt.res : svar({ fel: "Bolaget finns inte." }, 404);
      }
      nyttMoteId = lagt.kvar;
      const lagtSvar = (await lagt.res.clone().json()) as { ok?: string; varning?: string };
      bokat = lagtSvar.ok ?? "";
      bokatVarning = lagtSvar.varning ?? null;
    }

    await skrivHandelse({
      actorId: mig,
      action: inn.utfall === "avbokat" ? "mote.cancelled" : "mote.outcome_set",
      objectType: "mote",
      objectId: m.id,
      meta: { kedja: m.kedja_id, utfall: inn.utfall, resultat: a.mote.resultat ?? null, kedja_avslut: a.kedja && "avslut" in a.kedja ? a.kedja.avslut : null, nytt_mote: nyttMoteId },
    });

    // Stängs kedjan loggas den som för knapparna Nej och Affär (`nej`, `kund`), utöver mötets utfall.
    const avslut = a.kedja && "avslut" in a.kedja ? (a.kedja.avslut as string) : null;
    if (avslut === "affar") {
      await skrivHandelse({ actorId: mig, action: "mote.chain_won", objectType: "mote_kedja", objectId: m.kedja_id, meta: { mote: m.id } });
    } else if (avslut) {
      await skrivHandelse({ actorId: mig, action: "mote.chain_lost", objectType: "mote_kedja", objectId: m.kedja_id, meta: { mote: m.id, avslut, skal: (a.kedja?.nej_skal as string | undefined) ?? null } });
    }

    // 4. Avbokat: ställ in händelsen i kalendern.
    let varning: string | null = bokatVarning;
    if (inn.utfall === "avbokat") {
      const kalFel = await stallInIKalender(m);
      if (kalFel) varning = [varning, `Mötet är avbokat på tavlan, men kunde inte ställas in i kalendern (${kalFel}). Ställ in det där.`].filter(Boolean).join(" ");
    }
    const text = inn.utfall === "avbokat" ? "Mötet är avbokat." : inn.utfall === "uteblev" ? "Uteblev sparat." : "Utfallet är sparat.";
    return svar({ ok: `${text}${bokat ? " " + bokat : ""}`, mote: m.id, ...(nyttMoteId ? { nytt_mote: nyttMoteId } : {}), ...(varning ? { varning } : {}) });
  }

  /**
   * Radera ett möte (V6a). Rättigheten prövas här (`farRadera`); databasfunktionen `mote_radera` (0268) gör själva
   * raderingen atomärt, med kedjan och bolaget om mötet var det enda, och räknar om deltagarna annars.
   *
   * Har mötet inget utfall ställs kalenderhändelsen in (gästen får en avbokning), som för Avbokat. Misslyckas det är mötet
   * ändå raderat på tavlan, så svaret är ok med en varning. Ett möte med utfall rör inte kalendern: det har redan hänt
   * eller redan ställts in. `p_bara_oppet` följer med, så att ett utfall som sätts mellan läsningen och raderingen ger 409.
   */
  async function radera(): Promise<Response> {
    const r = moteIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const m = await hamtaMote(r.varden.mote);
    if (!m) return svar({ fel: "Mötet finns inte." }, 404);
    if (!farRadera(aktorn, m)) return svar({ fel: "Bara de som är med på mötet kan radera det, och bara innan det fått ett utfall. Ett möte med utfall raderas av en säljchef." }, 403);

    const { data, error } = await db.rpc("mote_radera", { p_mote: m.id, p_bara_oppet: m.utfall === null });
    if (error) return svar({ fel: "Mötet kunde inte raderas." }, 500);
    if (data === null) return svar({ fel: "Mötet har ändrats. Ladda om tavlan." }, 409);
    const res = data as { kedja: string; bolag: string; kedja_borta: boolean; bolag_borta: boolean };

    await skrivHandelse({
      actorId: mig,
      action: "mote.deleted",
      objectType: "mote",
      objectId: m.id,
      meta: { kedja: res.kedja, bolag: res.bolag, utfall: m.utfall, mote_tid: m.mote_tid, bokat_av: m.bokat_av, halls_av: m.halls_av, kedja_borta: res.kedja_borta, bolag_borta: res.bolag_borta },
    });

    let varning: string | null = null;
    if (m.utfall === null) {
      const kalFel = await stallInIKalender(m);
      if (kalFel) varning = `Mötet är raderat, men kunde inte ställas in i kalendern (${kalFel}). Ställ in det där.`;
    }
    return svar({ ok: "Mötet är raderat.", mote: m.id, kedja_borta: res.kedja_borta, ...(varning ? { varning } : {}) });
  }

  /**
   * Ändra ett öppet möte (2026-11-03): bolagets uppgifter, källan, målet och nuläget, tiden, platsen, kollegorna
   * och fler hos kunden. Bara det som står i anropet ändras (`andraIndata`), och samma rätt som Flytta (`farSe`).
   * Hållaren byts inte här: kalenderns arrangör står fast, och ett nytt möte bokas i stället.
   *
   * ORDNING (och vad som tas tillbaka):
   *  1. Mötesraden (källa, mål, nuläge, och en ny tid som i `flytta`: räknaren stegas och Bekräftat nollställs),
   *     villkorad på att utfall saknas och på den tid klienten såg. Ingen rad = 409.
   *  2. Kalendern i ett anrop som hållaren (`lk_spara_mote`, 0212): tid, plats, länk, rubrik, agenda och
   *     kollegor. Funktionen räknar själv ut vad som ändrats och ger ETT besked per person; en ny tid eller plats
   *     ger gästerna en uppdaterad inbjudan (`calendar_event_ics`). Fallerar den tas mötesraden tillbaka.
   *  3. Bolaget. 4. Gästerna: de nya bjuds in (`lead_bjud_in`); de borttagna tas bort ur mötet och får en
   *     avbokning (`lk_ics_ko` CANCEL, som utkorgen skickar eftersom adressen inte är med längre).
   *  5. Loggen, och en notis till hållaren när någon annan ändrat hens möte (kalendern säger inget till
   *     arrangören om ändringar arrangören själv står som aktör för).
   *
   * Rubriken följer bolagets namn bara när den är Mötens egen (`arEgenRubrik`), och agendan följer målet
   * bara när den är målet: det som ändrats i Kalendern för hand skrivs inte över.
   */
  async function andra(): Promise<Response> {
    const r = andraIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const v = r.varden;
    const h = await moteForSe(v.mote);
    if ("res" in h) return h.res;
    const m = h.m;
    if (m.utfall) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
    if (lokal(m.mote_tid) !== v.fore) return svar({ fel: "Mötet har ändrats. Ladda om tavlan." }, 409);
    const kedja = await hamtaKedja(m.kedja_id);
    if (!kedja) return svar({ fel: "Kedjan finns inte." }, 404);
    const { data: bolagRad } = await db.from("mote_bolag").select("id, namn, kontakt, telefon, epost, doman").eq("id", kedja.bolag_id).maybeSingle();
    const bo = bolagRad as { id: string; namn: string; kontakt: string | null; telefon: string | null; epost: string | null; doman: string | null } | null;
    if (!bo) return svar({ fel: "Bolaget finns inte." }, 404);

    // Kalenderns läge just nu: det som inte ändras skickas tillbaka som det är.
    type Handelse = { dag: string; tid: string | null; minuter: number | null; title: string; plats: string | null; online_url: string | null; agenda_md: string | null; cancelled_at: string | null };
    type Narvaro = { employee_id: string | null; external_email: string | null; optional: boolean | null };
    let kal: Handelse | null = null;
    let narvaro: Narvaro[] = [];
    if (m.event_id) {
      const [e, a] = await Promise.all([
        db.from("calendar_event").select("dag, tid, minuter, title, plats, online_url, agenda_md, cancelled_at").eq("id", m.event_id).maybeSingle(),
        db.from("calendar_attendee").select("employee_id, external_email, optional").eq("event_id", m.event_id).limit(200),
      ]);
      const ev = (e.data as unknown as Handelse | null) ?? null;
      kal = ev && !ev.cancelled_at && ev.tid ? ev : null;
      narvaro = (a.data ?? []) as unknown as Narvaro[];
    }
    const eventId = m.event_id;

    // Vad som ändras, mot det som står i databasen (inte mot det klienten trodde).
    const bolagLapp: Record<string, string | null> = {};
    for (const [k, x] of Object.entries(v.bolag)) if ((x ?? null) !== ((bo as Record<string, unknown>)[k] ?? null)) bolagLapp[k] = x ?? null;
    const moteLapp: Record<string, unknown> = {};
    if (v.kalla !== undefined && v.kalla !== m.kalla) moteLapp.kalla = v.kalla;
    if (v.mal !== undefined && (v.mal ?? null) !== (m.mal ?? null)) moteLapp.mal = v.mal;
    if (v.nulage !== undefined && (v.nulage ?? null) !== (m.nulage ?? null)) moteLapp.nulage = v.nulage;
    let nyTid: Date | null = null;
    if (v.tid) {
      const t = svenskTidpunkt(v.tid.dag, v.tid.start);
      if (!Number.isFinite(t.getTime())) return svar({ fel: "Välj en starttid." }, 400);
      if (t.getTime() !== new Date(m.mote_tid).getTime()) nyTid = t;
    }
    if (nyTid) Object.assign(moteLapp, { mote_tid: nyTid.toISOString(), antal_flyttningar: m.antal_flyttningar + 1, bekraftat_nar: null, bekraftat_av: null });

    // Kollegorna: hela listan som den ska bli, utan hållaren. De nya måste vara anställda (Kalenderns `lk_aktiv`).
    const medFore = [...new Set(narvaro.map((x) => x.employee_id).filter((x): x is string => !!x && x !== m.halls_av))];
    const medNu = v.med ? v.med.filter((x) => x !== m.halls_av) : medFore;
    const medIn = medNu.filter((x) => !medFore.includes(x));
    const medUt = medFore.filter((x) => !medNu.includes(x));
    if ((await aktiva(medIn)).length !== medIn.length) return svar({ fel: "En av kollegorna finns inte längre i Nav. Ta bort namnet och försök igen." }, 400);

    // Gästerna: kontakten (när hen har en adress) och fler hos kunden. Räknas bara när adressen eller listan ändras,
    // så att en ändring av målet aldrig skickar något till kunden.
    const epostFore = (bo.epost ?? "").toLowerCase() || null;
    const epostNu = "epost" in bolagLapp ? bolagLapp.epost : epostFore;
    const gastFore = [...new Set(narvaro.map((x) => (x.external_email ?? "").toLowerCase()).filter(Boolean))];
    let gastIn: string[] = [];
    let gastUt: string[] = [];
    if ("epost" in bolagLapp || v.gaster) {
      const fler = v.gaster ?? gastFore.filter((x) => x !== epostFore);
      const gastNu = [...new Set([...(epostNu ? [epostNu] : []), ...fler])];
      gastIn = gastNu.filter((x) => !gastFore.includes(x));
      gastUt = gastFore.filter((x) => !gastNu.includes(x));
    }

    const platsFore = kal?.plats ?? MOTE_PLATS;
    const lankFore = kal?.online_url ?? null;
    const platsNu = v.plats ? v.plats.plats : platsFore;
    const lankNu = v.plats ? v.plats.lank : lankFore;
    const platsAndras = platsNu !== platsFore || (lankNu ?? "") !== (lankFore ?? "");
    const egenRubrik = moteRubrik(bo.namn);
    const titel = kal && bolagLapp.namn && arEgenRubrik(kal.title, bo.namn) ? moteRubrik(bolagLapp.namn) : kal?.title ?? egenRubrik;
    const agenda = kal && "mal" in moteLapp && (kal.agenda_md ?? "") === (m.mal ?? "") ? String(moteLapp.mal ?? "") : kal?.agenda_md ?? "";
    const kalAndras = !!kal && (!!nyTid || platsAndras || titel !== kal.title || agenda !== (kal.agenda_md ?? "") || medIn.length > 0 || medUt.length > 0);
    const gastAndras = gastIn.length > 0 || gastUt.length > 0;

    if (!Object.keys(bolagLapp).length && !Object.keys(moteLapp).length && !kalAndras && !gastAndras && !platsAndras) {
      return svar({ ok: "Inget ändrades.", mote: m.id, kedja: m.kedja_id });
    }
    const varningar: string[] = [];
    if (!kal && (nyTid || platsAndras || medIn.length || medUt.length || gastAndras)) {
      varningar.push("Mötet saknar kalenderhändelse, så kalendern och inbjudningarna är orörda.");
    }

    // 1. Mötesraden, villkorad som Flytta.
    if (Object.keys(moteLapp).length) {
      const { data, error } = await db.from("mote").update(moteLapp).eq("id", m.id).is("utfall", null).eq("mote_tid", m.mote_tid).select("id");
      if (error) return svar({ fel: "Ändringen kunde inte sparas." }, 500);
      if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Mötet har ändrats. Ladda om tavlan." }, 409);
    }
    const tillbaka = async (): Promise<boolean> => {
      if (!Object.keys(moteLapp).length) return true;
      const fore = Object.fromEntries(Object.keys(moteLapp).map((k) => [k, (m as unknown as Record<string, unknown>)[k]]));
      const { data } = await db.from("mote").update(fore).eq("id", m.id).eq("mote_tid", String(moteLapp.mote_tid ?? m.mote_tid)).select("id");
      return ((data ?? []) as unknown[]).length > 0;
    };

    // 2. Kalendern i ett anrop, som hållaren (som `flyttaIKalender`; `farSe` är prövat på mötet ovan).
    type Sparat = { andrat: string[]; skickat?: { besked?: number; ics?: boolean } };
    let sparat: Sparat | null = null;
    if (kal && eventId && kalAndras) {
      const s = await lk<Sparat>("lk_spara_mote", {
        p_aktor: m.halls_av,
        p_event: eventId,
        p_dag: nyTid && v.tid ? v.tid.dag : kal.dag,
        p_tid: nyTid && v.tid ? `${v.tid.start}:00` : kal.tid,
        p_minuter: kal.minuter ?? m.langd_min,
        p_title: titel,
        p_plats: platsNu,
        p_online_url: lankNu,
        p_agenda: agenda.slice(0, 4000),
        p_deltagare: medNu,
        p_valfria: narvaro.filter((x) => x.employee_id && x.optional && medNu.includes(x.employee_id)).map((x) => x.employee_id),
        p_reminder_min: null,
        p_reminder_off: null,
        p_show_as: null,
        p_privat: null,
      });
      if (!s.ok) {
        if (!(await tillbaka())) return svar({ fel: `Kalendern tog inte emot ändringen (${s.fel}) och tavlan kunde inte tas tillbaka. Kolla mötet i kalendern.` }, 500);
        return svar({ fel: s.fel }, 400);
      }
      sparat = s.data;
    }

    // 3. Bolaget. Samma uppgifter står på bolagets alla kort; ett annat nummer kan höra till ett annat bolag.
    if (Object.keys(bolagLapp).length) {
      const { error } = await db.from("mote_bolag").update(bolagLapp).eq("id", bo.id);
      if (error) varningar.push("Bolagets uppgifter kunde inte sparas. Försök igen.");
      else if (bolagLapp.telefon) {
        const uv = uppslagsVarning(await slaUpp(bolagLapp.telefon, null, null), nar);
        if (uv) varningar.push(uv);
      }
    }

    // 4. Gästerna: de borttagna först (raden bort, sedan avbokningen), sedan de nya.
    const utOk: string[] = [];
    const inOk: string[] = [];
    const gastFel: string[] = [];
    if (kal && eventId) {
      for (const g of gastUt) {
        const { error } = await db.from("calendar_attendee").delete().eq("event_id", eventId).ilike("external_email", g.replace(/[\\%_]/g, (t) => `\\${t}`));
        if (!error) {
          await db.rpc("lk_ics_ko", { p_event: eventId, p_epost: g, p_metod: "CANCEL" });
          utOk.push(g);
        } else gastFel.push(g);
      }
      for (const g of gastIn) {
        const { error } = await db.rpc("lead_bjud_in", { p_event: eventId, p_epost: g });
        if (error) gastFel.push(g);
        else inOk.push(g);
      }
    }
    if (sparat?.andrat.length || utOk.length || inOk.length) efterKalender();

    const falt = [...Object.keys(bolagLapp), ...Object.keys(moteLapp).filter((k) => !["antal_flyttningar", "bekraftat_nar", "bekraftat_av"].includes(k)), ...(platsAndras ? ["plats"] : []), ...(medIn.length || medUt.length ? ["med"] : []), ...(gastAndras ? ["gaster"] : [])];
    await skrivHandelse({
      actorId: mig,
      action: "mote.edited",
      objectType: "mote",
      objectId: m.id,
      meta: { kedja: m.kedja_id, falt, ...(nyTid ? { fran: m.mote_tid, till: nyTid.toISOString() } : {}), med_in: medIn, med_ut: medUt, gaster_in: inOk.length, gaster_ut: utOk.length },
    });

    // 5. Hållaren får veta när någon annan ändrat hens möte.
    const namnNu = bolagLapp.namn ?? bo.namn;
    if (m.halls_av !== mig) {
      const vad = [nyTid ? "ny tid" : "", platsAndras ? "ny plats" : "", medIn.length || medUt.length ? "kollegor" : "", gastAndras ? "gäster" : "", Object.keys(bolagLapp).length ? "kunduppgifter" : "", "mal" in moteLapp || "nulage" in moteLapp || "kalla" in moteLapp ? "inför mötet" : ""].filter(Boolean);
      await notifiera({
        till: m.halls_av,
        av: mig,
        kalla: "mote-andrat",
        typ: "kalender",
        rubrik: `${forFor(fullName(user!.employee!))} ändrade ett möte åt dig`,
        detalj: `${namnNu} · ${nar(nyTid ?? m.mote_tid)}${vad.length ? ` · ${lista(vad)}` : ""}`,
        href: `/moten/${m.id}`,
        objekt: { typ: "mote", id: m.id },
      });
    }

    // Kvittot: vad som ändrats och vem som får veta det.
    const kontakt = forFor(bolagLapp.kontakt ?? bo.kontakt ?? "");
    const kvar = gastFore.filter((x) => !utOk.includes(x));
    const kundVem = kvar.length === 1 ? (kvar[0] === epostNu && kontakt ? kontakt : kvar[0]) : kvar.length ? (epostNu && kvar.includes(epostNu) ? `${kontakt || "Kunden"} och ${kvar.length - 1} till hos kunden` : `${kvar.length} hos kunden`) : "";
    const ics = !!sparat?.skickat?.ics;
    const delar = [
      nyTid ? `Mötet ligger nu ${nar(nyTid)}.` : "Ändringarna är sparade.",
      platsAndras && kal ? `Platsen är ${lankNu ? `${platsNu}, med länk` : platsNu}.` : "",
      medIn.length ? `${lista(await fornamnFor(medIn))} får en inbjudan i Nav.` : "",
      medUt.length ? `${lista(await fornamnFor(medUt))} får besked om att mötet är inställt.` : "",
      sparat?.skickat?.besked && (nyTid || platsAndras) ? (nyTid ? "Kollegorna på mötet får den nya tiden." : "Kollegorna på mötet får besked om platsen.") : "",
      ics && kundVem ? `${kundVem} får ${nyTid ? "den nya tiden" : "den nya platsen"} med mejl.` : "",
      inOk.length ? `${lista(inOk)} får en inbjudan med mejl.` : "",
      utOk.length ? `${lista(utOk)} får en avbokning med mejl.` : "",
      gastFel.length ? `${lista(gastFel)} gick inte att ändra. Försök igen, eller ändra i kalendern.` : "",
    ].filter(Boolean);
    if (v.plats && platsNu === videoNamn(null) && !lankNu) varningar.push("Teams-länken saknas. Lägg till den under Ändra, så får kunden den med mejl.");
    return svar({ ok: delar.join(" "), mote: m.id, kedja: m.kedja_id, ...(varningar.length ? { varning: varningar.join(" ") } : {}) });
  }

  /** Kedjans id och rätten att ändra den utan möte: med i kedjan, eller chef. */
  async function kedjaForAndra(id: string): Promise<{ k: KedjaRad } | { res: Response }> {
    const k = await hamtaKedja(id);
    if (!k) return { res: svar({ fel: "Kedjan finns inte." }, 404) };
    if (!farAndraKedja(aktorn, k.deltagare)) return { res: svar({ fel: "Du har inte tillgång till det här kortet." }, 403) };
    return { k };
  }

  async function kund(): Promise<Response> {
    const r = kundIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const v = r.varden;
    const { data: ord } = await db.from("sales_order").select("id, salesperson_id, created_by").eq("id", v.order).maybeSingle();
    if (!ord) return svar({ fel: "Ordern finns inte." }, 404);

    let m: MoteRad | null = null;
    let k: KedjaRad;
    if (v.mote) {
      m = await hamtaMote(v.mote);
      if (!m) return svar({ fel: "Mötet finns inte." }, 404);
      if (m.kedja_id !== v.kedja) return svar({ fel: "Mötet hör inte till kedjan." }, 400);
      if (!farSe(aktorn, m)) return svar({ fel: "Du har inte tillgång till det här mötet." }, 403);
      if (!farSattaUtfall(aktorn, m)) return svar({ fel: "Bara de som är med på mötet eller en säljchef sätter utfallet." }, 403);
      if (m.utfall) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
      const kk = await hamtaKedja(v.kedja);
      if (!kk) return svar({ fel: "Kedjan finns inte." }, 404);
      k = kk;
    } else {
      const h = await kedjaForAndra(v.kedja);
      if ("res" in h) return h.res;
      k = h.k;
      if (await harOppetMote(k.id)) return svar({ fel: "Kortet har ett bokat möte. Sätt utfallet på mötet." }, 409);
    }
    if (k.avslut) return svar({ fel: "Kortet är redan avslutat." }, 409);

    // Ordern ska höra till kortet: inte redan kopplad till ett annat, och lagd av eller tillhörande en deltagare (annars chef).
    const { data: annan } = await db.from("mote_kedja").select("id").eq("order_id", v.order).neq("id", k.id).limit(1);
    if (((annan ?? []) as unknown[]).length > 0) return svar({ fel: "Ordern är redan kopplad till ett annat kort." }, 409);
    const o = ord as unknown as { salesperson_id: string | null; created_by: string | null };
    if (!farKopplaOrder(aktorn, k.deltagare, o)) return svar({ fel: "Ordern hör inte till det här kortet." }, 403);

    const a = andringForKund(m !== null);
    const nuIso = new Date().toISOString();
    if (m && a.mote) {
      const { data, error } = await db
        .from("mote")
        .update({ ...a.mote, utfall_nar: nuIso, utfall_av: mig, resultat_nar: nuIso, resultat_av: mig })
        .eq("id", m.id)
        .is("utfall", null)
        .select("id");
      if (error) return svar({ fel: "Affären kunde inte sparas." }, 500);
      if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Mötet har redan fått ett utfall." }, 409);
    }
    const { data, error } = await db
      .from("mote_kedja")
      .update({ ...a.kedja, avslut_nar: nuIso, avslut_av: mig, order_id: v.order })
      .eq("id", k.id)
      .is("avslut", null)
      .select("id");
    if (error || ((data ?? []) as unknown[]).length === 0) {
      if (m && !(await angraUtfall(m.id, nuIso))) return svar({ fel: HALVSKRIVET }, 500);
      return error ? svar({ fel: "Affären kunde inte sparas." }, 500) : svar({ fel: "Kortet är redan avslutat." }, 409);
    }
    await skrivHandelse({ actorId: mig, action: "mote.chain_won", objectType: "mote_kedja", objectId: k.id, meta: { order: v.order, mote: m?.id ?? null } });
    return svar({ ok: "Affären är sparad. Kortet lämnar tavlan.", kedja: k.id });
  }

  async function nej(): Promise<Response> {
    const r = nejIndata(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const h = await kedjaForAndra(r.varden.kedja);
    if ("res" in h) return h.res;
    const k = h.k;
    if (k.avslut) return svar({ fel: "Kortet är redan avslutat." }, 409);
    // Nej stänger kedjan från Följ upp eller Tyst. Med ett bokat möte sätts utfallet på mötet.
    if (await harOppetMote(k.id)) return svar({ fel: "Kortet har ett bokat möte. Sätt utfallet på mötet." }, 409);
    const nuIso = new Date().toISOString();
    const { data, error } = await db
      .from("mote_kedja")
      .update({ avslut: "nej", avslut_nar: nuIso, avslut_av: mig, nej_skal: r.varden.skal })
      .eq("id", k.id)
      .is("avslut", null)
      .select("id");
    if (error) return svar({ fel: "Nejet kunde inte sparas." }, 500);
    if (((data ?? []) as unknown[]).length === 0) return svar({ fel: "Kortet är redan avslutat." }, 409);
    await skrivHandelse({ actorId: mig, action: "mote.chain_lost", objectType: "mote_kedja", objectId: k.id, meta: { skal: r.varden.skal } });
    return svar({ ok: "Nej sparat. Kortet lämnar tavlan.", kedja: k.id });
  }

  // ===========================================================================
  // A8, uppföljningen
  // ===========================================================================

  /**
   * `inget_svar` och `prova_igen`. Båda villkoras på `uppfoljning_andrad is not distinct from fore`, och
   * båda sätter den till nu, så att två begäranden från samma vy (samma `fore`) bara räknas en gång.
   *
   * Räknaren stegas som `inget_svar_i_rad = <läst värde> + 1` i en uppdatering som villkoras på att
   * versionen är oförändrad sedan läsningen: varje skrivning som rör `inget_svar_i_rad` sätter också
   * `uppfoljning_andrad`, så oförändrad version = oförändrad räknare. (Frågebyggaren kan inte skriva
   * `kolumn + 1`; villkoret gör att det inte behövs.) Samma uppdatering som SQL: `SQL_INGET_SVAR` i
   * motenforma.ts, som `moten-db.mjs --inget-svar-prov` kör.
   */
  async function uppfoljning(vilken: "inget_svar" | "prova_igen"): Promise<Response> {
    const r = kedjaFore(b);
    if (!r.ok) return svar({ fel: r.fel }, 400);
    const h = await kedjaForAndra(r.varden.kedja);
    if ("res" in h) return h.res;
    const k = h.k;
    if (k.avslut) return svar({ fel: "Kortet är redan avslutat." }, 409);
    const AENDRAT = "Kortet har ändrats. Ladda om tavlan.";
    if (await harOppetMote(k.id)) return svar({ fel: "Kortet har ett bokat möte." }, 409);

    const nu = new Date();
    const idag = svensktDatum(nu);
    const lapp =
      vilken === "inget_svar"
        ? { ...efterIngetSvar(idag), inget_svar_i_rad: k.inget_svar_i_rad + 1, uppfoljning_andrad: nu.toISOString() }
        : { uppfoljning_datum: idag, inget_svar_i_rad: 0, uppfoljning_andrad: nu.toISOString() };
    const upd = db.from("mote_kedja").update(lapp).eq("id", k.id).is("avslut", null);
    const { data, error } = await (r.varden.fore === null ? upd.is("uppfoljning_andrad", null) : upd.eq("uppfoljning_andrad", r.varden.fore)).select("id, inget_svar_i_rad, uppfoljning_datum, uppfoljning_andrad");
    if (error) return svar({ fel: "Det kunde inte sparas." }, 500);
    const rad = ((data ?? []) as { id: string; inget_svar_i_rad: number; uppfoljning_datum: string; uppfoljning_andrad: string }[])[0];
    if (!rad) return svar({ fel: AENDRAT }, 409);
    await skrivHandelse({
      actorId: mig,
      action: vilken === "inget_svar" ? "mote.no_answer" : "mote.retry",
      objectType: "mote_kedja",
      objectId: k.id,
      meta: { uppfoljning_datum: rad.uppfoljning_datum, inget_svar_i_rad: rad.inget_svar_i_rad },
    });
    const tyst = rad.inget_svar_i_rad >= TYST_EFTER_INGET_SVAR;
    return svar({
      ok: vilken === "prova_igen" ? "Kortet ligger i Följ upp igen. Ring i dag." : tyst ? "Inget svar tre gånger. Kortet ligger i Tyst." : `Inget svar. Ring igen ${rad.uppfoljning_datum}.`,
      kedja: k.id,
      uppfoljning_datum: rad.uppfoljning_datum,
      inget_svar_i_rad: rad.inget_svar_i_rad,
      // Nya versionen: klienten skickar den som `fore` vid nästa tryck utan att ladda om.
      uppfoljning_andrad: rad.uppfoljning_andrad,
    });
  }
}
