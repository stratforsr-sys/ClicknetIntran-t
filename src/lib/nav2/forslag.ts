import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { lasSidvis } from "@/lib/sidvis";
import {
  FORSLAG_NYCKLAR, TREND_BEHOVER, facitPerVal, harNyttHem, kortAndrat, lasForslagInst, nyckelDelar, oppetLage, troddeAvstamning,
  type AndratIn, type AndratKort, type Beslut, type FacitRad, type ForslagInst, type ForslagMote, type MotesUtfall, type Val,
} from "./forslagforma";
import {
  KALLRAD, dagText, narText, textAndratInledning, textAndringDom, textDom, textFacit, textFacitEgen, textFacitKort, textKortForslag, textKortObekraftade, textObekraftat, textTrendSaknas, textTrodde, type KortForslag,
} from "./hemtext";
import { MATT, type MattNyckel } from "./matt";
import { lasInstallningar, lokalDag, type MotenInst } from "./motesflode";
import { kretsFor } from "./motesstatforma";
import type { NAv } from "./statistik";
import type { AndringDom } from "./forslagforma";

/**
 * Nav 2.0: förslagsloggen på servern (0303).
 *
 * ===========================================================================
 * LÄSNINGEN GÅR GENOM LÄSARENS EGEN KLIENT, så att RLS avgör vilka rader som
 * kommer ut: personen raden handlar om, de som får se den personens tal enligt
 * `mote_statkrets()`, lagets teamledare för en lagrad och säljchef, vd och
 * admin för resten. Här filtreras ingenting som ersätter det.
 *
 * SKRIVNINGEN SKER BARA FRÅN SERVERN (service role), efter kontroll i rutten.
 * Tabellerna tar bara emot nya rader; läget läses ur vyn `nav_forslag_lage`.
 *
 * TEXTERNA skrivs av mallarna i `hemtext.ts`, aldrig här och aldrig av AI.
 * Servern skickar färdiga rader, så att samma data alltid ger samma text.
 * Provrader (`prov`) hålls utanför alla listor och tal.
 * ===========================================================================
 */

type Db = SupabaseClient;

export const REGEL_OBEKRAFTAT = "moten.obekraftat";

/** Vyn `nav_forslag_lage`: en rad per förslag med det senaste som gäller. */
export type LageRad = {
  id: string;
  sort: "forslag" | "andring";
  regel: string;
  nyckel: string;
  kalla: "regel" | "person" | "installning";
  om: string | null;
  lag: string | null;
  skapad: string;
  skapad_av: string | null;
  belagg: Record<string, unknown> | null;
  trodde: NAv | null;
  val: string[] | null;
  foljer: Record<string, unknown> | null;
  doms_dag: string | null;
  utgar: string | null;
  text: string | null;
  prov: boolean;
  beslut_id: string | null;
  beslut: { val?: Beslut; skal?: string } | null;
  beslut_av: string | null;
  beslut_nar: string | null;
  atgard: { uppgift?: string; fran?: string | null; ny?: boolean } | null;
  kommentar: { text?: string } | null;
  kommentar_nar: string | null;
  matning: Record<string, unknown> | null;
  matning_nar: string | null;
  dom: Record<string, unknown> | null;
  dom_nar: string | null;
};

export const LAGE_KOL =
  "id, sort, regel, nyckel, kalla, om, lag, skapad, skapad_av, belagg, trodde, val, foljer, doms_dag, utgar, text, prov, beslut_id, beslut, beslut_av, beslut_nar, atgard, kommentar, kommentar_nar, matning, matning_nar, dom, dom_nar";

export type NdForslagRad = {
  id: string;
  /** Mötet förslaget gäller, för Flytta mötet. */
  mote: string | null;
  /** "Hagby Glas i morgon 09.00". */
  rubrik: string;
  /** Det Nav säger: läget, hur det brukar gå, och vad Nav inte ser. */
  rader: string[];
  val: Val[];
  utgar: string | null;
  /** Hur texten kom till. */
  kalla: string;
  /** Kortet Nav föreslår: talet, vad det räknar, en mening och knappen (skiss 9). */
  kort: KortForslag;
};

export type NdAndring = {
  id: string;
  sort: "forslag" | "andring";
  /** Raden i klartext. För ett förslag: vad som valdes och hur det gick. För en ändring: personens ord. */
  text: string;
  /** Domen i ord. null när raden fortfarande följs. */
  dom: string | null;
  /** Talen bakom domen, när de finns: "3 av 22 uteblev. Bokade per vecka: …". */
  tal: string | null;
  /** Åt vilket håll det gick: "upp" = bättre, "ned" = sämre, "vet" = inget att säga än, eller ett förslag (ett möte döms aldrig). */
  ton: "upp" | "ned" | "vet";
  /** Har ändringen fått sin slutliga dom? false = den följs fortfarande. */
  stangd: boolean;
  /** När raden senast fick en dom eller en mätning, annars när den skapades. */
  nar: string;
  /** Förnamnet på den raden gäller. null = läsaren själv, laget eller hela företaget. */
  vem: string | null;
  /** Vem raden gäller: läsaren själv, en annan person, ett lag eller alla (en inställning, eller en ändring för hela företaget). */
  galler: "dig" | "person" | "laget" | "alla";
  /** Personens egen rad om sina tal. Personens ord, inte Navs. */
  kommentar: string | null;
  /** "regel", "person" eller "installning": var raden kom ifrån. */
  fran: LageRad["kalla"];
  kalla: string;
};

export type NdForslag = {
  /** Skapar jobben förslag? Av = de räknar bara och skriver i sitt kvitto. */
  pa: boolean;
  oppna: NdForslagRad[];
  /** Kortets rad: "2 möten i morgon är obekräftade". null när inget är öppet. */
  kortrad: string | null;
  andrat: NdAndring[];
  /** Kortet Det som ändrats: hur många som följs, nästa dom, det mätta talet och texten (skiss 9). */
  andratKort: AndratKort;
  /** Hur långt trendregeln har kvar: avgjorda möten mot de 60 den behöver. */
  trend: { har: number; behover: number };
  /** Samma sak i ord, medan regeln är tyst. null när den har det den behöver. */
  trendrad: string | null;
};

export const TOMT_ANDRATKORT: AndratKort = { foljs: 0, nastaDom: null, stort: null, text: "" };
export const TOMT_FORSLAG: NdForslag = { pa: false, oppna: [], kortrad: null, andrat: [], andratKort: TOMT_ANDRATKORT, trend: { har: 0, behover: TREND_BEHOVER }, trendrad: null };

/** Kortets underlag ur en loggrad: texten och tonen som raden visas med, och den senaste mätningens tal. */
function somAndratIn(rad: LageRad, x: NdAndring): AndratIn {
  const m = (rad.dom ?? rad.matning) as { efter?: unknown } | null;
  const matt = MATT[(rad.foljer?.matt ?? rad.regel) as MattNyckel];
  return { sort: rad.sort, text: x.text, ton: x.ton, stangd: x.stangd, domsDag: rad.doms_dag, dommen: !!rad.dom, efter: somNAv(m?.efter), mattKort: matt?.kort ?? null };
}

/* ------------------------------------------------------------------------ */
/* Inställningarna och kretsen                                               */
/* ------------------------------------------------------------------------ */

/**
 * Inställningarna för förslagen och Möten. Ett läsfel KASTAS i stället för att ge förvalen, så att ett fel aldrig ser
 * ut som att inget är inställt (fel tidszon, förslagen av, ingen i `hem.nytt`). Hemmet gör felet till `lasfel.inst`,
 * rutterna till sitt felbesked och nattjobbet till ett fel i kvittot.
 */
export async function lasInst(db: Db): Promise<{ f: ForslagInst; m: MotenInst }> {
  const { data, error } = await db.from("nav_setting").select("key, value").or(`key.like.forslag.%,key.like.moten.%,key.eq.${FORSLAG_NYCKLAR.hemNytt}`).limit(200);
  if (error) throw new Error(`inställningarna gick inte att läsa: ${error.message}`);
  const rader = (data ?? []) as { key: string; value: unknown }[];
  return { f: lasForslagInst(rader), m: lasInstallningar(rader) };
}

export { harNyttHem };

/**
 * Kretsen ur `mote_statkrets()`: null = alla (bara säljchef, vd och admin), en
 * lista = personerna läsaren får se, undefined = det gick inte att läsa. Ett
 * fel öppnar aldrig något.
 */
export async function lasKrets(supabase: Db, user: CurrentUser): Promise<string[] | null | undefined> {
  const { data, error } = await supabase.rpc("mote_statkrets");
  if (error) return undefined;
  const ra = data === null || data === undefined ? null : Array.isArray(data) && data.every((x) => typeof x === "string") ? (data as string[]) : undefined;
  return kretsFor(ra, user.roles);
}

/** Har läsaren en krets större än sig själv? */
export const arChefFor = (krets: readonly string[] | null | undefined, mig: string): boolean =>
  krets === null || (Array.isArray(krets) && krets.some((id) => id !== mig));

/* ------------------------------------------------------------------------ */
/* Mötena bakom raderna                                                      */
/* ------------------------------------------------------------------------ */

type MoteRad = {
  id: string; kedja_id: string; bokat_av: string; halls_av: string; bokat_nar: string; flyttad_nar: string | null; mote_tid: string;
  art: string; bekraftat_nar: string | null; utfall: string | null; utfall_nar: string | null; forsok: number | null;
};
export type MotesInfo = { m: ForslagMote; kedja: string; forsok: number; kund: string };

const MOTE_KOL = "id, kedja_id, bokat_av, halls_av, bokat_nar, flyttad_nar, mote_tid, art, bekraftat_nar, utfall, utfall_nar, forsok";

export const somForslagMote = (r: MoteRad): ForslagMote => ({
  id: r.id,
  moteTid: r.mote_tid,
  senastAndrad: r.flyttad_nar ?? r.bokat_nar,
  hallsAv: r.halls_av,
  bokatAv: r.bokat_av,
  art: r.art,
  bekraftat: r.bekraftat_nar !== null,
  bekraftatNar: r.bekraftat_nar,
  utfall: r.utfall,
  utfallNar: r.utfall_nar,
});

/**
 * Mötena och kundens namn, för de möten raderna pekar på. Ett möte som är borta saknas i svaret. `strikt`: ett läsfel
 * kastas, i stället för att mötet saknas (och förslaget tyst faller bort ur kortet). Hemmets läsningar är strikta;
 * nattjobbet och Teamet läser som förut.
 */
export async function motesInfo(db: Db, ids: readonly string[], strikt = false): Promise<Map<string, MotesInfo>> {
  const ut = new Map<string, MotesInfo>();
  const unika = [...new Set(ids)].filter(Boolean);
  if (!unika.length) return ut;
  const { data: mr, error: mf } = await db.from("mote").select(MOTE_KOL).in("id", unika).limit(unika.length);
  if (mf && strikt) throw new Error(`mötena gick inte att läsa: ${mf.message}`);
  const rader = (mr ?? []) as unknown as MoteRad[];
  if (!rader.length) return ut;
  const kedjor = [...new Set(rader.map((r) => r.kedja_id))];
  const { data: kr, error: kf } = await db.from("mote_kort").select("kedja_id, namn").in("kedja_id", kedjor).limit(kedjor.length);
  if (kf && strikt) throw new Error(`kunderna gick inte att läsa: ${kf.message}`);
  const namn = new Map(((kr ?? []) as unknown as { kedja_id: string; namn: string | null }[]).map((k) => [k.kedja_id, k.namn?.trim() || "kunden"]));
  for (const r of rader) ut.set(r.id, { m: somForslagMote(r), kedja: r.kedja_id, forsok: r.forsok ?? 0, kund: namn.get(r.kedja_id) ?? "kunden" });
  return ut;
}

/** Förnamn för de anställda raderna nämner. `strikt`: ett läsfel kastas i stället för tomma namn (se motesInfo). */
export async function fornamn(db: Db, ids: readonly (string | null | undefined)[], strikt = false): Promise<Map<string, string>> {
  const unika = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unika.length) return new Map();
  const { data, error } = await db.from("employee").select("id, first_name").in("id", unika).limit(unika.length);
  if (error) throw new Error(`namnen gick inte att läsa: ${error.message}`);
  return new Map(((data ?? []) as unknown as { id: string; first_name: string | null }[]).map((e) => [e.id, (e.first_name ?? "").trim()]));
}

const moteFor = (rad: Pick<LageRad, "nyckel" | "regel">): string | null => (rad.regel === REGEL_OBEKRAFTAT ? nyckelDelar(rad.nyckel)?.mote ?? null : null);

const somNAv = (x: unknown): NAv | null => {
  const o = x as { n?: unknown; av?: unknown } | null;
  return o && typeof o.n === "number" && typeof o.av === "number" ? { n: o.n, av: o.av } : null;
};

/* ------------------------------------------------------------------------ */
/* Raderna i den form hemmet ritar                                           */
/* ------------------------------------------------------------------------ */

/** Ett öppet förslag: rubriken och Navs tre rader. Antal, aldrig en orsak. */
export function somForslagRad(rad: LageRad, info: MotesInfo | undefined, namn: Map<string, string>, mig: string, nu: Date, tz: string): NdForslagRad {
  const val = ((rad.val ?? []) as string[]).filter((v): v is Val => v === "ringer-sjalv" || v === "flytta" || v === "lat-sta");
  if (!info) return { id: rad.id, mote: moteFor(rad), rubrik: "Ett möte", rader: ["Mötet finns inte längre."], val: [], utgar: rad.utgar, kalla: KALLRAD.regler, kort: { tal: "1", vad: "möte finns inte längre", text: "Mötet finns inte längre.", knapp: "Visa" } };
  const nar = narText(info.m.moteTid, nu, tz);
  const belagg = rad.belagg ?? {};
  // Det Nav trodde skrevs på raden när den skapades och ändras inte i efterhand. Saknas uppgiften om
  // underlaget räcker säger texten att det är för få: hellre det än en jämförelse utan grund.
  const m = { kund: info.kund, dag: nar.dag, kl: nar.kl, bokare: namn.get(info.m.bokatAv) || null, forsok: info.forsok, jag: info.m.bokatAv === mig };
  const rader = textObekraftat(
    m,
    rad.trodde,
    belagg.forFa !== false,
    somNAv(belagg.bekraftade),
  );
  return { id: rad.id, mote: info.m.id, rubrik: `${info.kund} ${nar.dag} ${nar.kl}`, rader, val, utgar: rad.utgar, kalla: KALLRAD.regler, kort: textKortForslag(m) };
}

const arUtfall = (x: unknown): x is MotesUtfall => x === "hallet" || x === "uteblev" || x === "avbokat" || x === "flyttat" || x === "okant";

/** En rad i Det som ändrats: ett dömt förslag, eller en ändring som följs eller har fått sin dom. */
export function somAndring(rad: LageRad, info: MotesInfo | undefined, namn: Map<string, string>, mig: string): NdAndring {
  const vem = rad.om && rad.om !== mig ? namn.get(rad.om) || null : null;
  const galler: NdAndring["galler"] = rad.om === mig ? "dig" : rad.om ? "person" : rad.lag ? "laget" : "alla";
  const bas = { id: rad.id, sort: rad.sort, vem, galler, kommentar: typeof rad.kommentar?.text === "string" ? rad.kommentar.text : null, fran: rad.kalla, kalla: KALLRAD.regler };
  if (rad.sort === "forslag") {
    const v = rad.beslut?.val;
    const val: Val | "ingen" = v === "ringer-sjalv" || v === "flytta" || v === "lat-sta" ? v : "ingen";
    const utfall = rad.dom ? (arUtfall(rad.dom.utfall) ? rad.dom.utfall : "okant") : null;
    const text = textDom({ kund: info?.kund ?? "Ett möte", val, utfall, bekraftat: rad.dom?.bekraftat === true, ...(vem ? { vem } : {}) });
    return { ...bas, text, dom: null, tal: null, ton: "vet", stangd: !!rad.dom, nar: senastNar(rad) };
  }
  // Slutdomen går före. Finns ingen än gäller nattens senaste mätning.
  const senaste = (rad.dom ?? rad.matning) as { dom?: AndringDom; tal?: unknown } | null;
  const matt = MATT[(rad.foljer?.matt ?? rad.regel) as MattNyckel];
  const motvikt = matt?.motvikt ? MATT[matt.motvikt] : undefined;
  const d = senaste?.dom;
  const dom = d ? textAndringDom(d, motvikt?.samre ?? "motvikten har blivit sämre") : null;
  const ton = d?.sort === "ser-bra-ut" || d?.sort === "battre-men" ? "upp" : d?.sort === "ser-samre-ut" ? "ned" : "vet";
  const stangd = (rad.dom as { dom?: AndringDom } | null)?.dom?.stangd === true;
  return { ...bas, text: rad.text ?? "En ändring", dom, tal: typeof senaste?.tal === "string" ? senaste.tal : null, ton, stangd, nar: senastNar(rad) };
}

/** När raden senast hände något: domen, annars mätningen, annars valet, annars när den skapades. */
const senastNar = (r: LageRad): string => r.dom_nar ?? r.matning_nar ?? r.beslut_nar ?? r.skapad;
const nyastForst = (x: LageRad, y: LageRad): number => Date.parse(senastNar(y)) - Date.parse(senastNar(x));

/* ------------------------------------------------------------------------ */
/* Startladdningen: den lilla läsningen                                      */
/* ------------------------------------------------------------------------ */

/**
 * Det hemmet behöver direkt: personens öppna förslag, det senaste som ändrats
 * och hur långt trendregeln har kvar. Tre små frågor; mötena och namnen läses
 * bara när det finns rader att visa.
 *
 * Ett läsfel KASTAS, så att det inte ser ut som ett lugnt tomläge ("Inga förslag
 * just nu."). Hemmet (byggHem) fångar det och sätter `lasfel.forslag`, och
 * resten av startsidan ritas ändå. Chattens verktyg ger sitt eget felbesked.
 */
export async function byggForslag(supabase: Db, user: CurrentUser, inst?: { f: ForslagInst; m: MotenInst }, nu: Date = new Date()): Promise<NdForslag> {
  if (!user.employee) return TOMT_FORSLAG;
  const mig = user.employee.id;
  const admin = supabaseAdmin();
  const i = inst ?? (await lasInst(admin));
  const tz = i.m.tidszon;
  const [oppna, andrade, avgjorda] = await Promise.all([
    supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("om", mig).eq("sort", "forslag").eq("prov", false).is("beslut_id", null).is("dom", null).gt("utgar", nu.toISOString()).order("utgar", { ascending: true }).limit(20),
    supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("prov", false).or("sort.eq.andring,dom.not.is.null,matning.not.is.null").order("skapad", { ascending: false }).limit(30),
    admin.from("mote").select("id", { count: "exact", head: true }).in("utfall", ["hallet", "uteblev"]).neq("art", "uppfoljning").gte("mote_tid", i.m.gallerFran ?? "1970-01-01T00:00:00Z"),
  ]);
  // supabase-js kastar inte: ett fel kommer som `error`, och data är då null. Utan den här raden blir felet ett tomt kort.
  const fel = oppna.error ?? andrade.error ?? avgjorda.error;
  if (fel) throw new Error(`förslagen gick inte att läsa: ${fel.message}`);
  const o = (oppna.data ?? []) as unknown as LageRad[];
  const allaA = ((andrade.data ?? []) as unknown as LageRad[]).sort(nyastForst);
  const a = allaA.slice(0, 3);
  const trend = { har: avgjorda.count ?? 0, behover: TREND_BEHOVER };
  const trendrad = trend.har < trend.behover ? textTrendSaknas(trend.har, trend.behover) : null;
  if (!o.length && !a.length) return { pa: i.f.pa, oppna: [], kortrad: null, andrat: [], andratKort: TOMT_ANDRATKORT, trend, trendrad };

  const [info, namn] = await Promise.all([
    motesInfo(admin, [...o, ...allaA].map(moteFor).filter((x): x is string => !!x), true),
    fornamn(admin, [...allaA.map((r) => r.om)], true),
  ]);
  const idag = lokalDag(nu.toISOString(), tz);
  const bokare = await fornamn(admin, o.map((r) => info.get(moteFor(r) ?? "")?.m.bokatAv), true);
  // Bara det som fortfarande går att välja i står i kortet. Resten stänger nattjobbet.
  const kvar = o.filter((r) => oppetLage(r.nyckel, r.utgar ?? "", info.get(moteFor(r) ?? "")?.m ?? null, nu, tz) === "oppet");
  const dagar = [...new Set(kvar.map((r) => lokalDag(info.get(moteFor(r) ?? "")!.m.moteTid, tz)))];
  return {
    pa: i.f.pa,
    oppna: kvar.map((r) => somForslagRad(r, info.get(moteFor(r) ?? ""), bokare, mig, nu, tz)),
    kortrad: kvar.length ? textKortObekraftade(kvar.length, dagar.length === 1 ? dagText(dagar[0], lokalDag(nu, tz)) : null) : null,
    andrat: a.map((r) => somAndring(r, info.get(moteFor(r) ?? ""), namn, mig)),
    andratKort: kortAndrat(allaA.map((r) => somAndratIn(r, somAndring(r, info.get(moteFor(r) ?? ""), namn, mig))), idag),
    trend,
    trendrad,
  };
}

/* ------------------------------------------------------------------------ */
/* Genomgångarna: tunga läsningar när ett kort öppnas                        */
/* ------------------------------------------------------------------------ */

export type Genomgang = { status: number; data: Record<string, unknown> };
const nej = (status: number, fel: string): Genomgang => ({ status, data: { fel } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Raderna bakom Navs facit: dömda förslag om obekräftade möten, i läsarens krets (RLS). */
export function facitRader(rader: readonly LageRad[]): FacitRad[] {
  const ut: FacitRad[] = [];
  for (const r of rader) {
    const d = nyckelDelar(r.nyckel);
    const beslut = r.beslut?.val;
    if (!d || !r.dom || !beslut || !arUtfall(r.dom.utfall)) continue;
    ut.push({ beslut, utfall: r.dom.utfall, om: d.om, dag: d.dag });
  }
  return ut;
}

/** Rollerna som kan leda ett lag. Samma lista som byggHem använder när kretsen inte gick att läsa. */
const LEDARROLLER: readonly string[] = ["team_lead", "sales_manager", "ceo", "admin"];
const kanLeda = (user: CurrentUser): boolean => (user.roles as readonly string[]).some((r) => LEDARROLLER.includes(r));

/**
 * Alla dömda förslag om obekräftade möten, sida för sida: REST-lagret kapar ett svar vid 1000 rader utan att säga
 * det, och ett facit på en del av raderna vore ett fel tal som ser rätt ut. `om` = bara den personens rader. Ett fel
 * kastas (lasSidvis).
 */
function dommaRader(supabase: Db, om?: string): Promise<LageRad[]> {
  return lasSidvis<LageRad>((a, b) => {
    const q = supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("prov", false).not("dom", "is", null);
    return (om ? q.eq("om", om) : q).order("skapad", { ascending: true }).order("id").range(a, b) as unknown as PromiseLike<{ data: LageRad[] | null; error: { message: string } | null }>;
  });
}

/** Lagets facit: alla dömda rader läsaren ser (RLS), per val, och Navs gissning mot utfallet (från 20 möten). */
async function lagetsFacit(supabase: Db, grans: number) {
  const rader = await dommaRader(supabase);
  const facit = facitPerVal(facitRader(rader), grans);
  const trodde = troddeAvstamning(
    rader.filter((r) => r.trodde && r.dom && arUtfall(r.dom.utfall)).map((r) => ({ trodde: r.trodde as NAv, utfall: r.dom!.utfall as MotesUtfall })),
  );
  return { facit, trodde };
}

/**
 * Raden "I laget hittills: …" i ett förslag, bara för den som leder ett lag. Alla andra får null: lagets tal i
 * säljarens förslag är ett beslut om synlighet som inte är fattat. Raden är ett tillägg, så ett läsfel här fäller
 * inte förslaget: det loggas och raden uteblir. Också kretsen: `lasKrets` kastar inte utan ger undefined, och för den
 * som kan leda ett lag är det ett läsfel, inte "leder inte" (samma regel som grenen `facit`).
 */
async function facitKortFor(supabase: Db, user: CurrentUser, grans: number): Promise<string | null> {
  if (!user.employee) return null;
  const loggaFel = (e: unknown) => {
    console.error(`forslag: lagets facit till förslaget gick inte att läsa: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };
  try {
    const krets = await lasKrets(supabase, user);
    if (krets === undefined && kanLeda(user)) return loggaFel(new Error("kretsen (mote_statkrets) gick inte att läsa"));
    if (!arChefFor(krets, user.employee.id)) return null;
    return textFacitKort((await lagetsFacit(supabase, grans)).facit);
  } catch (e) {
    return loggaFel(e);
  }
}

export async function lasGenomgang(user: CurrentUser, vad: string, id?: string | null, nu: Date = new Date()): Promise<Genomgang> {
  if (!user.employee) return nej(401, "Du måste vara inloggad.");
  const mig = user.employee.id;
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();
  const inst = await lasInst(admin);
  const tz = inst.m.tidszon;

  if (vad === "forslag") {
    if (!id || !UUID.test(id)) return nej(400, "Förslaget finns inte.");
    const { data, error } = await supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("id", id).maybeSingle();
    // Ett läsfel är inte "finns inte": det blir 500 med en felkod (rutten), och klienten erbjuder Försök igen.
    if (error) throw new Error(`förslaget gick inte att läsa: ${error.message}`);
    const rad = data as unknown as LageRad | null;
    if (!rad || rad.sort !== "forslag") return nej(404, "Förslaget finns inte.");
    const info = await motesInfo(admin, [moteFor(rad)].filter((x): x is string => !!x), true);
    const i = info.get(moteFor(rad) ?? "");
    const namn = await fornamn(admin, [i?.m.bokatAv, rad.om], true);
    const lage = rad.dom ? "domt" : rad.beslut_id ? "valt" : oppetLage(rad.nyckel, rad.utgar ?? "", i?.m ?? null, nu, tz);
    const facitKort = await facitKortFor(supabase, user, inst.f.gransFacit);
    return {
      status: 200,
      data: {
        forslag: {
          ...somForslagRad(rad, i, namn, mig, nu, tz),
          lage,
          mitt: rad.om === mig,
          valt: rad.beslut?.val ?? null,
          domsDag: rad.doms_dag ? dagText(rad.doms_dag, lokalDag(nu, tz)) : null,
          dom: rad.dom ? somAndring(rad, i, namn, mig).text : null,
          kommentar: typeof rad.kommentar?.text === "string" ? rad.kommentar.text : null,
          // Lagets facit på en rad, bara för den som leder ett lag (null för alla andra). Säljaren får aldrig lagets tal här.
          facitKort,
          // Dagen talen gäller (företagets tidszon), för källraden "data per": en delläsning sätter inte ND.nu.
          dataPer: lokalDag(nu, tz),
        },
      },
    };
  }

  if (vad === "andrat") {
    const { data, error } = await supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("prov", false).or("sort.eq.andring,dom.not.is.null,matning.not.is.null").order("skapad", { ascending: false }).limit(200);
    if (error) throw new Error(`det som ändrats gick inte att läsa: ${error.message}`);
    const rader = ((data ?? []) as unknown as LageRad[]).sort(nyastForst);
    const [info, namn, krets] = await Promise.all([
      motesInfo(admin, rader.map(moteFor).filter((x): x is string => !!x), true),
      fornamn(admin, rader.map((r) => r.om), true),
      lasKrets(supabase, user),
    ]);
    const nd = rader.map((r) => ({ rad: r, x: somAndring(r, info.get(moteFor(r) ?? ""), namn, mig) }));
    const kort = kortAndrat(nd.map(({ rad, x }) => somAndratIn(rad, x)), lokalDag(nu.toISOString(), tz));
    const foljda = nd.filter(({ x }) => x.sort === "andring" && !x.stangd).map(({ x }) => x);
    return {
      status: 200,
      data: {
        andrat: nd.map(({ rad, x }) => ({ ...x, mitt: rad.om === mig })),
        foljs: kort.foljs,
        nastaDom: kort.nastaDom,
        inledning: textAndratInledning({ foljs: foljda.length, bra: foljda.filter((x) => x.ton === "upp").length, samre: foljda.filter((x) => x.ton === "ned").length, tidiga: foljda.filter((x) => x.ton === "vet").length }),
        // Vad läsaren får berätta om: sig själv alltid, kretsen och laget när hen har en. `krets` är listan som
        // formuläret får erbjuda (null = alla), så att ingen väljs som servern sedan nekar.
        farLaget: arChefFor(krets, mig),
        krets: krets === undefined ? [mig] : krets,
        matt: (Object.values(MATT) as (typeof MATT)[MattNyckel][]).filter((m) => m.sort === "andel").map((m) => ({ nyckel: m.nyckel, text: m.text, serInte: m.serInte })),
        kalla: KALLRAD.regler,
      },
    };
  }

  if (vad === "facit") {
    const krets = await lasKrets(supabase, user);
    // Kretsen gick inte att läsa. För den som kan leda ett lag vore "Dina val" ett tyst fel (hen skulle tro att laget
    // saknas), så det blir 500 med en felkod. För en säljare spelar kretsen ingen roll: hen får alltid sina egna rader.
    if (krets === undefined && kanLeda(user)) throw new Error("kretsen (mote_statkrets) gick inte att läsa");
    if (arChefFor(krets, mig)) {
      const { facit, trodde } = await lagetsFacit(supabase, inst.f.gransFacit);
      return {
        status: 200,
        data: { facit: { ...facit, text: textFacit(facit), trodde: trodde ? textTrodde(trodde) : null, kalla: KALLRAD.regler, dataPer: lokalDag(nu, tz), vem: "laget" } },
      };
    }
    // Den som inte leder ett lag: bara de egna valen, i antal, och aldrig en dom. Raderna läses med ett uttryckligt
    // filter på personen, inte med RLS ensam: säljchef, vd och admin ser alla rader (0303, nav_forslag_las).
    // `dom` och `trodde` skickas inte alls. Ett utslag om en persons möten vore ett facit om personen.
    const egna = await dommaRader(supabase, mig);
    const f = facitPerVal(facitRader(egna), inst.f.gransFacit);
    return {
      status: 200,
      data: { facit: { per: f.per, detalj: f.detalj, flyttade: f.flyttade, text: textFacitEgen(f), trodde: null, kalla: KALLRAD.regler, dataPer: lokalDag(nu, tz), vem: "dig" } },
    };
  }

  return nej(400, "Okänd läsning.");
}

/* ------------------------------------------------------------------------ */
/* Flytta mötet: valet sparas när flytten är gjord                           */
/* ------------------------------------------------------------------------ */

/**
 * Anropas av Mötens rutt när ett möte har flyttats. Har mötet ett öppet förslag
 * som är ställt till den som flyttade sparas valet Flytta. Flyttar någon annan
 * sparas inget val: då stänger nattjobbet raden som inaktuell, och den räknas
 * inte i facit. Ett fel här får aldrig stoppa flytten, som redan är gjord.
 */
export async function forslagEfterFlytt(db: Db, mote: string, av: string): Promise<void> {
  try {
    const { data } = await db.from("nav_forslag_lage").select("id, nyckel, om, beslut_id, dom").eq("regel", REGEL_OBEKRAFTAT).eq("om", av).is("beslut_id", null).is("dom", null).limit(50);
    for (const r of (data ?? []) as unknown as Pick<LageRad, "id" | "nyckel" | "om" | "beslut_id" | "dom">[]) {
      if (r.om !== av || r.beslut_id || r.dom || nyckelDelar(r.nyckel)?.mote !== mote) continue;
      const { error } = await db.rpc("nav_forslag_valj", { p_forslag: r.id, p_av: av, p_data: { val: "flytta" } });
      if (error) console.error(`forslag: valet Flytta gick inte att spara för ${r.id}: ${error.message}`);
    }
  } catch (e) {
    console.error(`forslag: efter flytten: ${e instanceof Error ? e.message : String(e)}`);
  }
}
