import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { lasSidvis } from "@/lib/sidvis";
import {
  FORSLAG_NYCKLAR, TREND_BEHOVER, facitPerVal, lasForslagInst, nyckelDelar, oppetLage, troddeAvstamning,
  type Beslut, type FacitRad, type ForslagInst, type ForslagMote, type MotesUtfall, type Val,
} from "./forslagforma";
import {
  KALLRAD, dagText, narText, textAndringDom, textDom, textFacit, textKortObekraftade, textObekraftat, textTrendSaknas, textTrodde,
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
  /** Hur långt trendregeln har kvar: avgjorda möten mot de 60 den behöver. */
  trend: { har: number; behover: number };
  /** Samma sak i ord, medan regeln är tyst. null när den har det den behöver. */
  trendrad: string | null;
};

export const TOMT_FORSLAG: NdForslag = { pa: false, oppna: [], kortrad: null, andrat: [], trend: { har: 0, behover: TREND_BEHOVER }, trendrad: null };

/* ------------------------------------------------------------------------ */
/* Inställningarna och kretsen                                               */
/* ------------------------------------------------------------------------ */

export async function lasInst(db: Db): Promise<{ f: ForslagInst; m: MotenInst }> {
  const { data } = await db.from("nav_setting").select("key, value").or(`key.like.forslag.%,key.like.moten.%,key.eq.${FORSLAG_NYCKLAR.hemNytt}`).limit(200);
  const rader = (data ?? []) as { key: string; value: unknown }[];
  return { f: lasForslagInst(rader), m: lasInstallningar(rader) };
}

/** Har personen det nya hemmet? */
export const harNyttHem = (f: ForslagInst, anstalld: string): boolean => f.hemNytt === "alla" || f.hemNytt.includes(anstalld);

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

/** Mötena och kundens namn, för de möten raderna pekar på. Ett möte som är borta saknas i svaret. */
export async function motesInfo(db: Db, ids: readonly string[]): Promise<Map<string, MotesInfo>> {
  const ut = new Map<string, MotesInfo>();
  const unika = [...new Set(ids)].filter(Boolean);
  if (!unika.length) return ut;
  const { data: mr } = await db.from("mote").select(MOTE_KOL).in("id", unika).limit(unika.length);
  const rader = (mr ?? []) as unknown as MoteRad[];
  if (!rader.length) return ut;
  const kedjor = [...new Set(rader.map((r) => r.kedja_id))];
  const { data: kr } = await db.from("mote_kort").select("kedja_id, namn").in("kedja_id", kedjor).limit(kedjor.length);
  const namn = new Map(((kr ?? []) as unknown as { kedja_id: string; namn: string | null }[]).map((k) => [k.kedja_id, k.namn?.trim() || "kunden"]));
  for (const r of rader) ut.set(r.id, { m: somForslagMote(r), kedja: r.kedja_id, forsok: r.forsok ?? 0, kund: namn.get(r.kedja_id) ?? "kunden" });
  return ut;
}

/** Förnamn för de anställda raderna nämner. */
export async function fornamn(db: Db, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unika = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unika.length) return new Map();
  const { data } = await db.from("employee").select("id, first_name").in("id", unika).limit(unika.length);
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
  if (!info) return { id: rad.id, mote: moteFor(rad), rubrik: "Ett möte", rader: ["Mötet finns inte längre."], val: [], utgar: rad.utgar, kalla: KALLRAD.regler };
  const nar = narText(info.m.moteTid, nu, tz);
  const belagg = rad.belagg ?? {};
  // Det Nav trodde skrevs på raden när den skapades och ändras inte i efterhand. Saknas uppgiften om
  // underlaget räcker säger texten att det är för få: hellre det än en jämförelse utan grund.
  const rader = textObekraftat(
    { kund: info.kund, dag: nar.dag, kl: nar.kl, bokare: namn.get(info.m.bokatAv) || null, forsok: info.forsok, jag: info.m.bokatAv === mig },
    rad.trodde,
    belagg.forFa !== false,
    somNAv(belagg.bekraftade),
  );
  return { id: rad.id, mote: info.m.id, rubrik: `${info.kund} ${nar.dag} ${nar.kl}`, rader, val, utgar: rad.utgar, kalla: KALLRAD.regler };
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
 * bara när det finns rader att visa. Ett fel ger ett tomt svar, aldrig en fälld
 * startsida.
 */
export async function byggForslag(supabase: Db, user: CurrentUser, inst?: { f: ForslagInst; m: MotenInst }, nu: Date = new Date()): Promise<NdForslag> {
  if (!user.employee) return TOMT_FORSLAG;
  const mig = user.employee.id;
  try {
    const admin = supabaseAdmin();
    const i = inst ?? (await lasInst(admin));
    const tz = i.m.tidszon;
    const [oppna, andrade, avgjorda] = await Promise.all([
      supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("om", mig).eq("sort", "forslag").eq("prov", false).is("beslut_id", null).is("dom", null).gt("utgar", nu.toISOString()).order("utgar", { ascending: true }).limit(20),
      supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("prov", false).or("sort.eq.andring,dom.not.is.null,matning.not.is.null").order("skapad", { ascending: false }).limit(30),
      admin.from("mote").select("id", { count: "exact", head: true }).in("utfall", ["hallet", "uteblev"]).neq("art", "uppfoljning").gte("mote_tid", i.m.gallerFran ?? "1970-01-01T00:00:00Z"),
    ]);
    const o = (oppna.data ?? []) as unknown as LageRad[];
    const a = ((andrade.data ?? []) as unknown as LageRad[])
      .sort(nyastForst)
      .slice(0, 3);
    const trend = { har: avgjorda.count ?? 0, behover: TREND_BEHOVER };
    const trendrad = trend.har < trend.behover ? textTrendSaknas(trend.har, trend.behover) : null;
    if (!o.length && !a.length) return { pa: i.f.pa, oppna: [], kortrad: null, andrat: [], trend, trendrad };

    const [info, namn] = await Promise.all([
      motesInfo(admin, [...o, ...a].map(moteFor).filter((x): x is string => !!x)),
      fornamn(admin, [...a.map((r) => r.om)]),
    ]);
    const bokare = await fornamn(admin, o.map((r) => info.get(moteFor(r) ?? "")?.m.bokatAv));
    // Bara det som fortfarande går att välja i står i kortet. Resten stänger nattjobbet.
    const kvar = o.filter((r) => oppetLage(r.nyckel, r.utgar ?? "", info.get(moteFor(r) ?? "")?.m ?? null, nu, tz) === "oppet");
    const dagar = [...new Set(kvar.map((r) => lokalDag(info.get(moteFor(r) ?? "")!.m.moteTid, tz)))];
    return {
      pa: i.f.pa,
      oppna: kvar.map((r) => somForslagRad(r, info.get(moteFor(r) ?? ""), bokare, mig, nu, tz)),
      kortrad: kvar.length ? textKortObekraftade(kvar.length, dagar.length === 1 ? dagText(dagar[0], lokalDag(nu, tz)) : null) : null,
      andrat: a.map((r) => somAndring(r, info.get(moteFor(r) ?? ""), namn, mig)),
      trend,
      trendrad,
    };
  } catch (e) {
    console.error(`forslag: startläsningen föll: ${e instanceof Error ? e.message : String(e)}`);
    return TOMT_FORSLAG;
  }
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

export async function lasGenomgang(user: CurrentUser, vad: string, id?: string | null, nu: Date = new Date()): Promise<Genomgang> {
  if (!user.employee) return nej(401, "Du måste vara inloggad.");
  const mig = user.employee.id;
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();
  const inst = await lasInst(admin);
  const tz = inst.m.tidszon;

  if (vad === "forslag") {
    if (!id || !UUID.test(id)) return nej(400, "Förslaget finns inte.");
    const { data } = await supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("id", id).maybeSingle();
    const rad = data as unknown as LageRad | null;
    if (!rad || rad.sort !== "forslag") return nej(404, "Förslaget finns inte.");
    const info = await motesInfo(admin, [moteFor(rad)].filter((x): x is string => !!x));
    const i = info.get(moteFor(rad) ?? "");
    const namn = await fornamn(admin, [i?.m.bokatAv, rad.om]);
    const lage = rad.dom ? "domt" : rad.beslut_id ? "valt" : oppetLage(rad.nyckel, rad.utgar ?? "", i?.m ?? null, nu, tz);
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
        },
      },
    };
  }

  if (vad === "andrat") {
    const { data } = await supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("prov", false).or("sort.eq.andring,dom.not.is.null,matning.not.is.null").order("skapad", { ascending: false }).limit(200);
    const rader = ((data ?? []) as unknown as LageRad[]).sort(nyastForst);
    const [info, namn, krets] = await Promise.all([
      motesInfo(admin, rader.map(moteFor).filter((x): x is string => !!x)),
      fornamn(admin, rader.map((r) => r.om)),
      lasKrets(supabase, user),
    ]);
    return {
      status: 200,
      data: {
        andrat: rader.map((r) => ({ ...somAndring(r, info.get(moteFor(r) ?? ""), namn, mig), mitt: r.om === mig })),
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
    if (!arChefFor(krets, mig)) return nej(403, "Lagets facit visas för den som leder ett lag.");
    // Alla dömda förslag, sida för sida: REST-lagret kapar ett svar vid 1000 rader utan att säga det, och ett facit
    // på en del av raderna vore ett fel tal som ser rätt ut.
    const rader = await lasSidvis<LageRad>((a, b) =>
      supabase.from("nav_forslag_lage").select(LAGE_KOL).eq("regel", REGEL_OBEKRAFTAT).eq("prov", false).not("dom", "is", null).order("skapad", { ascending: true }).order("id").range(a, b) as unknown as PromiseLike<{ data: LageRad[] | null; error: { message: string } | null }>,
    );
    const facit = facitPerVal(facitRader(rader), inst.f.gransFacit);
    const trodde = troddeAvstamning(
      rader.filter((r) => r.trodde && r.dom && arUtfall(r.dom.utfall)).map((r) => ({ trodde: r.trodde as NAv, utfall: r.dom!.utfall as MotesUtfall })),
    );
    return {
      status: 200,
      data: { facit: { ...facit, text: textFacit(facit), trodde: trodde ? textTrodde(trodde) : null, kalla: KALLRAD.regler } },
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
