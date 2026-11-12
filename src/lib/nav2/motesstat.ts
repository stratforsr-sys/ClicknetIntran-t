import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dagarBakat, svenskDygnsslut, svenskTidpunkt, svensktDatum } from "@/lib/klocka";
import {
  bakom, bekraftelsePerBokare, dagarTillMote, inomKrets, kretsFor, offerter, perKalla, vecka, veckotal,
  type Period, type StatKedja, type StatMote, type Veckotal,
} from "./motesstatforma";

/**
 * Nav 2.0: Möten, statistiken (B3), läsningen.
 *
 * ===========================================================================
 * RLS AVGÖR (0260-0261): mötena och kedjorna läses genom den inloggades klient.
 * Säljaren får de möten och kedjor hen är deltagare i, chefen (team_lead,
 * sales_manager, ceo, admin) alla. Här filtreras ingenting som ersätter det,
 * med ett undantag (0264): en ren teamledare ska enligt beställaren
 * (2026-10-31) bara se sitt eget team. Kretsen hämtas ur mote_statkrets()
 * (null = alla, annars de id:n personen leder, och sig själv), och möten, kedjor
 * och personer begränsas till den INNAN något räknas eller skickas till
 * klienten. Misslyckas kretsen stänger vi chefsvyn i stället för att öppna den.
 * Samtalen kommer ur mote_samtal_vecka (0263/0264), en SECURITY DEFINER-funktion
 * som själv ger säljaren sin egen rad, teamledaren teamets och övriga chefer alla.
 *
 * Alla tal räknas i motesstatforma.ts (B2). Den här filen hämtar bara raderna
 * talen behöver: perioden P är förra veckans måndag till denna veckans söndag,
 * svensk tid, plus de öppna mötena och kedjorna (utan utfall respektive avslut)
 * som inte är veckobundna. Frågorna är separata och slås ihop på id, så att
 * ingen `.or()` behövs.
 *
 * Namnen på personerna läses med service role och bara som för- och efternamn,
 * samma undantag som i moten.ts.
 *
 * Läsningen tål att 0260-0263 inte är körda: då blir listorna tomma.
 * ===========================================================================
 */

const CHEFSROLLER = ["team_lead", "sales_manager", "ceo", "admin"] as const;

// REST-lagret och pgrest.ts kapar varje svar vid 1000 rader, så ett högre `.limit()` kapar tyst.
// Möten och kedjor läses därför sidvis (`order` + `range`) tills en sida ger färre än SIDA rader,
// med ett yttersta tak per fråga. Nås taket loggas det, så att tyst kapning inte sker obemärkt.
const SIDA = 1000;
const MAX_SIDOR = 10;
// rpc:n ger högst personer x 2 rader, långt under taket; når den det loggas det.
const MAX_SAMTAL = 1000;
// Så många id:n per `.in()`, så att adressraden till pgrest inte blir för lång.
const BIT = 100;

export type NdMotesstat = {
  jag: { denna: Veckotal; forra: Veckotal };
  chef: null | {
    /** "team": en teamledare ser bara sitt eget team (0264). "alla": säljchef, vd och admin. */
    krets: "alla" | "team";
    personer: { id: string; namn: string; denna: Veckotal; forra: Veckotal }[];
    offerter: ReturnType<typeof offerter>;
    dagar: ReturnType<typeof dagarTillMote>;
    kallor: ReturnType<typeof perKalla>;
    /** Per bokare: bekräftade före mötet och hur ofta bekräftade och obekräftade möten hölls (U9). */
    bekraftelser: ReturnType<typeof bekraftelsePerBokare>;
    utanUtfall: { id: string; namn: string; antal: number }[];
  };
  /** De två veckorna talen gäller (måndag-söndag, YYYY-MM-DD), så att klienten inte räknar om dem. */
  perioder: { denna: Period; forra: Period };
  /** Tidpunkten (ISO) då raderna lästes. Klienten skickar den som `fore`, så att samtalslistan inte visar samtal som kom efter talen. */
  las: string;
  /** True när en läsning nådde sitt tak (10 000 rader, eller 1000 samtalsrader) eller gav fel: talen kan vara för låga. */
  ofullstandig: boolean;
  moten: StatMote[];
  kedjor: StatKedja[]; // för bakom() i klienten
  /** Kedje-id till bolagets namn, för alla kedjor i `kedjor` och alla `kedja` i `moten`. Saknas namnet utelämnas nyckeln. */
  bolag: Record<string, string>;
  /**
   * Id:n bakom varje tal, färdiga ur B2:s bakom(), så att klienten inte räknar om dem. Nyckel är
   * anställnings-id: `jag` och, för chef, varje person i `chef.personer`. `samtal` och `per100` har
   * inga rader att visa; tomma listor utelämnas.
   */
  bakom: Record<string, { denna: BakomTal; forra: BakomTal }>;
};
type BakomTal = Partial<Record<keyof Veckotal, string[]>>;

type MoteRad = {
  id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: string | Date; mote_tid: string | Date;
  art: StatMote["art"]; utfall: StatMote["utfall"]; resultat: string | null; kalla: string;
  bekraftat_nar: string | Date | null;
};
type KedjaRad = {
  kedja_id: string; bolag_id: string; forsta_bokat_av: string | null; forsta_bokat_nar: string | Date | null; forsta_mote_tid: string | Date | null;
  forsta_hallna_halls_av: string | null; avslut: StatKedja["avslut"]; avslut_nar: string | Date | null;
  affar_forsta_mote: boolean | null; offert_nar: string | Date | null; kolumn: string | null; kalla: string | null;
};
type SamtalRad = { employee_id: string; vecka: string | Date; antal: number };
type Svar<T> = { data: T[] | null; error: { message?: string } | null };

const MOTE_KOLUMNER = "id, kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, art, utfall, resultat, kalla, bekraftat_nar";
const KEDJA_KOLUMNER =
  "kedja_id, bolag_id, forsta_bokat_av, forsta_bokat_nar, forsta_mote_tid, forsta_hallna_halls_av, avslut, avslut_nar, affar_forsta_mote, offert_nar, kolumn, kalla";

// pgrest ger strängar, den lokala pg-bryggan kan ge Date.
const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);
const isoEllerNull = (v: string | Date | null): string | null => (v === null || v === undefined ? null : iso(v));
// En `date`-kolumn: "2026-10-26". Som Date är den lokal midnatt, inte UTC.
const datum = (v: string | Date): string =>
  v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
    : v.slice(0, 10);

/**
 * Läser en fråga sidvis (`sida(fran, till)` ska ha en stabil `order` och `.range(fran, till)`).
 * Tål en fråga som misslyckas (saknad vy eller annat): tom lista, felet loggas och `kapad.v` sätts.
 */
async function sidvis<T>(
  namn: string, sida: (fran: number, till: number) => PromiseLike<unknown>, kapad: { v: boolean },
): Promise<T[]> {
  const alla: T[] = [];
  for (let i = 0; i < MAX_SIDOR; i++) {
    const svar = (await sida(i * SIDA, (i + 1) * SIDA - 1)) as Svar<T>;
    if (svar.error) {
      console.error(`motesstat: ${namn} misslyckades: ${svar.error.message ?? "okänt fel"}`);
      kapad.v = true; // talen bygger på färre rader än de borde (M3)
      return [];
    }
    const data = svar.data ?? [];
    alla.push(...data);
    if (data.length < SIDA) return alla;
  }
  console.error(`motesstat: ${namn} nådde taket (${MAX_SIDOR * SIDA} rader) och är kapad`);
  kapad.v = true;
  return alla;
}

/** Svar från rpc:n: tom lista vid fel (loggas), varning om svaret är lika långt som gränsen. */
function samtalsrader(svar: Svar<SamtalRad>, kapad: { v: boolean }): SamtalRad[] {
  if (svar.error) {
    console.error(`motesstat: samtal misslyckades: ${svar.error.message ?? "okänt fel"}`);
    kapad.v = true; // utan samtalen blir Samtal 0 och Bokade per 100 –: säg att talen inte är hela bilden (M3)
    return [];
  }
  const data = svar.data ?? [];
  if (data.length >= MAX_SAMTAL) {
    console.error(`motesstat: samtal gav ${MAX_SAMTAL} rader och kan vara kapad`);
    kapad.v = true;
  }
  return data;
}

function unika<T>(listor: T[][], nyckel: (t: T) => string): T[] {
  const per = new Map<string, T>();
  for (const lista of listor) for (const t of lista) per.set(nyckel(t), t);
  return [...per.values()];
}

// Alla tal i Veckotal som har rader bakom sig.
const TAL_MED_RADER = [
  "bokade", "hallna", "raddade", "affarer", "forstaMote", "bokatTillAffar", "oppnaOfferter", "tysta", "utanUtfall",
] as const satisfies readonly (keyof Veckotal)[];

const tomtTal = (nu: Date): Veckotal => veckotal("", { fran: "", till: "" }, [], [], 0, nu);

/** Svaret från mote_statkrets(): en lista id:n, null (= alla), eller undefined om svaret är fel eller konstigt format. */
function kretsAv(svar: { data: unknown; error: { message?: string } | null }): string[] | null | undefined {
  if (svar.error) {
    console.error(`motesstat: kretsen misslyckades: ${svar.error.message ?? "okänt fel"}`);
    return undefined;
  }
  if (svar.data === null || svar.data === undefined) return null;
  if (Array.isArray(svar.data) && svar.data.every((x) => typeof x === "string")) return svar.data as string[];
  console.error("motesstat: kretsen hade ett oväntat format");
  return undefined;
}

/**
 * Hela läsningen i try/catch (S4): ett kast ger en tom NdMotesstat i stället för att fälla startsidan.
 * Perioderna räknas ur klockan och kan inte kasta.
 */
export async function byggMotesstat(supabase: SupabaseClient, user: CurrentUser): Promise<NdMotesstat> {
  try {
    return await bygg(supabase, user);
  } catch (e) {
    console.error(`motesstat: bygget kastade: ${e instanceof Error ? e.message : String(e)}`);
    const nu = new Date();
    const denna = vecka(svensktDatum(nu));
    const forra = vecka(dagarBakat(denna.fran, 7));
    return {
      jag: { denna: tomtTal(nu), forra: tomtTal(nu) }, chef: null, perioder: { denna, forra },
      las: nu.toISOString(), ofullstandig: false, moten: [], kedjor: [], bolag: {}, bakom: {},
    };
  }
}

async function bygg(supabase: SupabaseClient, user: CurrentUser): Promise<NdMotesstat> {
  const nu = new Date();
  const kapad = { v: false };
  const denna: Period = vecka(svensktDatum(nu));
  const forra: Period = vecka(dagarBakat(denna.fran, 7));
  const perioder = { denna, forra };
  // P med zon: förra måndagen 00:00 till söndagens sista millisekund, svensk tid.
  const fran = svenskTidpunkt(forra.fran, "00:00").toISOString();
  const till = svenskDygnsslut(denna.till);

  // Villkoren är filtermetoder på frågebyggaren; typen är lös med flit, de ligger i anropen nedan.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const motenFraga = (namn: string, villkor: (q: any) => any) =>
    sidvis<MoteRad>(namn, (a, b) => villkor(supabase.from("mote").select(MOTE_KOLUMNER)).order("id").range(a, b), kapad);
  const kedjeFraga = (namn: string, villkor: (q: any) => any) =>
    sidvis<KedjaRad>(namn, (a, b) => villkor(supabase.from("mote_kedja_utfall").select(KEDJA_KOLUMNER)).order("kedja_id").range(a, b), kapad);

  /* eslint-enable @typescript-eslint/no-explicit-any */

  const [bokat, tid, oppnaMoten, oppnaKedjor, avslutade, offert, bokadeKedjor, samtalSvar, kretsSvar] = await Promise.all([
    motenFraga("möten (bokade i perioden)", (q) => q.gte("bokat_nar", fran).lte("bokat_nar", till)),
    motenFraga("möten (i perioden)", (q) => q.gte("mote_tid", fran).lte("mote_tid", till)),
    motenFraga("möten (öppna)", (q) => q.is("utfall", null)),
    kedjeFraga("kedjor (öppna)", (q) => q.is("avslut", null)),
    kedjeFraga("kedjor (avslutade i perioden)", (q) => q.gte("avslut_nar", fran).lte("avslut_nar", till)),
    kedjeFraga("kedjor (offert i perioden)", (q) => q.gte("offert_nar", fran).lte("offert_nar", till)),
    kedjeFraga("kedjor (bokade i perioden)", (q) => q.gte("forsta_bokat_nar", fran).lte("forsta_bokat_nar", till)),
    supabase.rpc("mote_samtal_vecka", { p_fran: forra.fran, p_till: denna.till }).limit(MAX_SAMTAL),
    supabase.rpc("mote_statkrets"),
  ]);
  // Tas direkt när läsningarna kommit tillbaka: samtal som Lynes skriver in efter detta hör inte till talen (S3).
  const las = new Date().toISOString();

  const moteRader = unika([bokat, tid, oppnaMoten], (m) => m.id);
  const kedjaRader = unika([oppnaKedjor, avslutade, offert, bokadeKedjor], (k) => k.kedja_id);
  let samtalRader = samtalsrader(samtalSvar as unknown as Svar<SamtalRad>, kapad);

  const allaMoten: StatMote[] = moteRader.map((m) => ({
    id: m.id, kedja: m.kedja_id, bokatAv: m.bokat_av, hallsAv: m.halls_av,
    bokatNar: iso(m.bokat_nar), moteTid: iso(m.mote_tid),
    art: m.art, utfall: m.utfall, resultat: m.resultat, kalla: m.kalla,
    bekraftatNar: isoEllerNull(m.bekraftat_nar),
  }));
  const allaKedjor: StatKedja[] = kedjaRader.map((k) => ({
    id: k.kedja_id,
    forstaBokatAv: k.forsta_bokat_av ?? "",
    forstaBokatNar: isoEllerNull(k.forsta_bokat_nar) ?? "",
    forstaMoteTid: isoEllerNull(k.forsta_mote_tid),
    forstaHallnaHallsAv: k.forsta_hallna_halls_av,
    avslut: k.avslut,
    avslutNar: isoEllerNull(k.avslut_nar),
    affarForstaMote: k.affar_forsta_mote === true,
    offertNar: isoEllerNull(k.offert_nar),
    kolumn: k.kolumn,
    kalla: k.kalla ?? "",
  }));

  // Teamledarens krets (0264). Bara en chefsroll begränsas av den; säljaren har RLS. null = alla.
  // Ett fel eller ett konstigt svar stänger chefsvyn och begränsar till sig själv, det öppnar den aldrig.
  const jagId = user.employee?.id ?? null;
  const arChef = hasRole(user, ...CHEFSROLLER);
  // null gäller som "alla" bara för sales_manager, ceo och admin (I1): för en ren teamledare är det ett fel.
  const kretsLast = kretsAv(kretsSvar as unknown as { data: unknown; error: { message?: string } | null });
  const kretsRå = arChef ? kretsFor(kretsLast, user.roles) : kretsLast;
  if (arChef && kretsLast === null && kretsRå === undefined) {
    console.error("motesstat: kretsen var null men rollen är inte sales_manager, ceo eller admin; chefsvyn stängs");
  }
  const kretsFel = arChef && kretsRå === undefined;
  const krets: string[] | null = !arChef ? null : kretsRå === undefined ? (jagId ? [jagId] : []) : kretsRå;
  const iKretsen = (id: string) => krets === null || krets.includes(id);
  const begransad = inomKrets(allaMoten, allaKedjor, krets);
  const moten = begransad.moten;
  const kedjor = begransad.kedjor;
  if (krets !== null) samtalRader = samtalRader.filter((s) => iKretsen(s.employee_id));

  // Samtal per person och vecka (veckans måndag). Två veckor, så en person kan ha flera rader.
  const samtal = new Map<string, number>();
  for (const s of samtalRader) {
    const nyckel = `${s.employee_id}|${datum(s.vecka)}`;
    samtal.set(nyckel, (samtal.get(nyckel) ?? 0) + s.antal);
  }
  const antalSamtal = (id: string, v: Period) => samtal.get(`${id}|${v.fran}`) ?? 0;
  const talFor = (id: string, m: StatMote[] = moten, k: StatKedja[] = kedjor) => ({
    denna: veckotal(id, denna, m, k, antalSamtal(id, denna), nu),
    forra: veckotal(id, forra, m, k, antalSamtal(id, forra), nu),
  });

  // De egna talen räknas på alla lästa rader, också när chefsvyn begränsas till teamet: hen ska se
  // samma tal som en säljare med samma rader. Utan anställningsrad finns inget id: tomma tal, inga kast.
  const jag = jagId ? talFor(jagId, allaMoten, allaKedjor) : { denna: tomtTal(nu), forra: tomtTal(nu) };

  // Bakom-listorna för `jag` och, nedan, för varje person i chefsvyn.
  const bakomFor = (id: string, m: StatMote[] = moten, k: StatKedja[] = kedjor) => {
    const per = (v: Period): BakomTal => {
      const ut: BakomTal = {};
      for (const tal of TAL_MED_RADER) {
        const lista = bakom(tal, id, v, m, k, nu);
        if (lista.length) ut[tal] = lista;
      }
      return ut;
    };
    return { denna: per(denna), forra: per(forra) };
  };
  const bakomAlla: NdMotesstat["bakom"] = jagId ? { [jagId]: bakomFor(jagId, allaMoten, allaKedjor) } : {};

  // Det som skickas till klienten: de begränsade raderna, plus de egna talens rader (de kan röra
  // någon utanför teamet, men hen får se dem som sina egna). Utan begränsning är det allt.
  const jagIds = new Set(Object.values(bakomAlla[jagId ?? ""] ?? {}).flatMap((v) => Object.values(v).flat()));
  const motenIds = new Set(moten.map((m) => m.id)), kedjorIds = new Set(kedjor.map((k) => k.id));
  const skickadeMoten = krets === null ? moten : allaMoten.filter((m) => jagIds.has(m.id) || motenIds.has(m.id));
  const skickadeKedjor = krets === null ? kedjor : allaKedjor.filter((k) => jagIds.has(k.id) || kedjorIds.has(k.id));
  const skickadeKedjeIds = new Set(skickadeKedjor.map((k) => k.id));
  const skickadeKedjaRader = krets === null ? kedjaRader : kedjaRader.filter((k) => skickadeKedjeIds.has(k.kedja_id));

  // Kedjornas bolagsnamn (RLS: samma rader som kedjorna). Kedjor som mötena pekar på men som
  // inte kom med i kedjefrågorna (gamla, stängda) slås upp för sig.
  const bolagAv = new Map(skickadeKedjaRader.map((k) => [k.kedja_id, k.bolag_id]));
  const saknadeKedjor = [...new Set(skickadeMoten.map((m) => m.kedja))].filter((id) => !bolagAv.has(id));
  const bitar = <T,>(lista: T[]) => Array.from({ length: Math.ceil(lista.length / BIT) }, (_, i) => lista.slice(i * BIT, (i + 1) * BIT));
  await Promise.all(bitar(saknadeKedjor).map(async (del) => {
    const { data, error } = await supabase.from("mote_kedja_utfall").select("kedja_id, bolag_id").in("kedja_id", del).limit(del.length);
    if (error) console.error(`motesstat: kedjornas bolag misslyckades: ${error.message}`);
    for (const k of (data ?? []) as unknown as { kedja_id: string; bolag_id: string }[]) bolagAv.set(k.kedja_id, k.bolag_id);
  }));
  const bolagNamn = new Map<string, string>();
  await Promise.all(bitar([...new Set(bolagAv.values())]).map(async (del) => {
    const { data, error } = await supabase.from("mote_bolag").select("id, namn").in("id", del).limit(del.length);
    if (error) console.error(`motesstat: bolagsnamnen misslyckades: ${error.message}`);
    for (const b of (data ?? []) as unknown as { id: string; namn: string }[]) bolagNamn.set(b.id, b.namn);
  }));
  const bolag: Record<string, string> = {};
  for (const [kedja, bolagId] of bolagAv) {
    const n = bolagNamn.get(bolagId);
    if (n) bolag[kedja] = n;
  }

  const ofullstandig = kapad.v;
  const utan = { jag, perioder, las, ofullstandig, moten: skickadeMoten, kedjor: skickadeKedjor, bolag, bakom: bakomAlla };
  if (!arChef || kretsFel) return { ...utan, chef: null };

  // Bara de som har gjort något: bokat eller hållit ett möte, eller ringt i perioden, och bara i kretsen.
  const ids = new Set<string>();
  for (const m of moten) { ids.add(m.bokatAv); ids.add(m.hallsAv); }
  for (const s of samtalRader) ids.add(s.employee_id);
  for (const id of [...ids]) if (!iKretsen(id)) ids.delete(id);

  const namn = new Map<string, string>();
  if (ids.size) {
    try {
      const { data, error } = await supabaseAdmin()
        .from("employee").select("id, first_name, last_name").in("id", [...ids]).limit(ids.size);
      if (error) console.error(`motesstat: namnen misslyckades: ${error.message}`);
      for (const p of (data ?? []) as unknown as { id: string; first_name: string; last_name: string }[]) namn.set(p.id, fullName(p));
    } catch (e) {
      console.error(`motesstat: namnen misslyckades: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const namnPa = (id: string) => namn.get(id) ?? "Okänd";

  const personer = [...ids]
    .map((id) => ({ id, namn: namnPa(id), ...(id === jagId ? jag : talFor(id)) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));

  // Möten utan utfall per hållare, ur B2:s veckotal (regeln +30 min står bara där). Varje hållare i
  // kretsen av ett möte i `moten` ligger i `ids` och därmed i `personer`.
  const utanUtfall = personer
    .filter((p) => p.denna.utanUtfall > 0)
    .map((p) => ({ id: p.id, namn: p.namn, antal: p.denna.utanUtfall }))
    .sort((a, b) => b.antal - a.antal || a.namn.localeCompare(b.namn, "sv"));

  for (const p of personer) bakomAlla[p.id] ??= bakomFor(p.id);

  return {
    ...utan,
    chef: {
      krets: krets === null ? "alla" : "team",
      personer,
      // Teamets block räknar bara rader som någon i kretsen äger (I2); moten/kedjor ovan är mängden som visas.
      offerter: offerter(kedjor, denna, krets),
      dagar: dagarTillMote(moten, denna, krets),
      kallor: perKalla(moten, kedjor, denna, krets),
      bekraftelser: bekraftelsePerBokare(moten, denna, krets),
      utanUtfall,
    },
  };
}
