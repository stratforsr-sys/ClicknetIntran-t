import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dagarBakat, svenskTidpunkt, svenskVeckodag, svensktDatum } from "@/lib/klocka";
import { lokal } from "./leads";
import { arHallare, KOLUMNER, MOTE_PLATS, platsTyp, type Kolumn, type Platstyp } from "./motenforma";
import {
  bekraftelseFonster, bradska, fordela, kortFas, lasInstallningar, manadFor, PIPE_KOLUMNER, sorteraFas, ursprungligBokare,
  type MotenInst, type PipeKolumn,
} from "./motesflode";

/**
 * Nav 2.0: Möten i utkastets former (moduler/ndmo.js), läsningen (A5).
 *
 * ===========================================================================
 * RLS AVGÖR (0260): chefen (team_lead, sales_manager, ceo, admin) ser alla
 * kedjor, säljaren de kedjor hen är deltagare i. Läsningen går genom vyn
 * `mote_kort` (en rad per öppen kedja, `security_invoker`), och kolumnen och
 * "idag"-markeringen räknas där, aldrig här: regeln står på ETT ställe
 * (mote_kolumn, 0261).
 *
 * Tid: `tid` är svensk lokal tid "YYYY-MM-DD HH:MM" (lokal() ur leads.ts),
 * `uppfoljning.datum` är ett färdigt datum "YYYY-MM-DD". Veckan för `vecka` är
 * måndag-söndag i Europe/Stockholm.
 *
 * Namnen på dem kortet pekar på, och listan över dem som kan hålla ett möte,
 * läses med service role och bara som för- och efternamn. Samma undantag som
 * i Leads: en säljare ser inte registret, men måste kunna välja kollega i
 * "Vem håller mötet" och se vem som bokat.
 *
 * Läsningen tål att 0260-0261 inte är körda: då är tavlan tom.
 *
 * PIPELINEN (0287, motesflode.ts): kortets `fas` räknas här ur mötestiden,
 * bekräftelsefönstret och inställningarna i nav_setting ("moten.*"). Reglerna
 * är fasta och står i motesflode.ts; bara namnen och talen är inställningar.
 * `kolumn` (mote_kolumn, 0261) finns kvar för uppföljningens lägen
 * (Följ upp, Tyst) och filtret "Följ upp i dag".
 * Avgjort har två delar: kedjorna i uppföljning (korten med `fas` "avgjort")
 * och månadens avgjorda möten (`avgjorda`), som är möten, inte kedjor.
 * ===========================================================================
 */

export type NdMoteKort = {
  kedja: string;
  bolag: string;
  namn: string;
  kontakt: string | null;
  telefon: string | null;
  epost: string | null;
  doman: string | null;
  kolumn: Kolumn;
  idag: boolean;
  /** Kolumnen på tavlan (motesflode.ts). En kedja utan öppet möte står i Avgjort. */
  fas: PipeKolumn;
  /** Bekräftelsefönstret, lokala dagar "YYYY-MM-DD". Null utan öppet möte. */
  fonster: { oppnar: string; senast: string } | null;
  bradska: "idag" | "imorgon" | null;
  /** Försöken att nå kunden sedan mötet bokades eller senast flyttades. */
  forsok: number;
  senastForsok: string | null;
  deltagare: string[];
  mote: {
    id: string;
    tid: string;
    langd: number;
    hallsAv: string;
    hallsAvNamn: string;
    bokatAv: string;
    bokatAvNamn: string;
    bekraftat: boolean;
    /** När mötet bekräftades, svensk lokal "YYYY-MM-DD HH:MM". */
    bekraftatNar: string | null;
    flyttningar: number;
    mal: string | null;
    nulage: string | null;
    /** Kollegorna i kalendern utöver hållaren, och gästerna hos kunden (också kontakten när hen är bjuden). `svar` som i Kalendern. */
    med: { id: string; namn: string; svar: string }[];
    gaster: { epost: string; svar: string }[];
    /** Källan som bokningen skrevs med, för Ändra. */
    kalla: string;
    /** Var mötet hålls (kalenderhändelsens `plats` och `online_url`): telefon, Teams med länk, eller adressen. */
    plats: { typ: Platstyp; text: string; lank: string | null };
  } | null;
  uppfoljning: { datum: string; text: string | null; offert: boolean; ingetSvar: number; andrad: string | null } | null;
  historik: { id: string; tid: string; text: string }[];
};

/** Ett möte som fått utfall i innevarande månad (Avgjort på tavlan). */
export type NdAvgjort = {
  mote: string;
  kedja: string;
  namn: string;
  /** Mötets tid, svensk lokal "YYYY-MM-DD HH:MM". */
  tid: string;
  utfall: "hallet" | "uteblev" | "avbokat";
  niva: "kvalificerat" | "hallet" | null;
  /** Hållet, utan nivå, och efter `moten.galler-fran`: säljaren har inte svarat på frågorna. */
  vantarBedomning: boolean;
  bekraftat: boolean;
  hallsAv: string;
  hallsAvNamn: string;
  bokatAv: string;
  bokatAvNamn: string;
  deltagare: string[];
  /** Betraktarens låsta mötesprovision för mötet, null utan rad. */
  belopp: number | null;
  skal: string | null;
};

export type NdMoten = {
  kort: NdMoteKort[];
  avgjorda: NdAvgjort[];
  /** Det som går att ställa in per företag och som tavlan behöver. */
  inst: Pick<MotenInst, "bekraftaDagar" | "kolumnnamn" | "fragor">;
  /** Betraktarens egen andel per kolumn, i kronor. Null för den som inte får mötesprovision. */
  provisionPaSpel: Record<PipeKolumn, number> | null;
  vecka: { affar: number; nej: number; kedjor: { kedja: string; namn: string; avslut: "affar" | "nej"; nar: string }[] };
  saljare: { id: string; namn: string }[];
  /** Alla som inte har slutat, att lägga till som kollegor i ett möte. */
  kollegor: { id: string; namn: string }[];
  chef: boolean;
};

const CHEFSROLLER = ["team_lead", "sales_manager", "ceo", "admin"] as const;

/** Tavlan visar öppna kedjor. REST-vägen kapar tyst vid 1000 rader, så taket sätts uttryckligen. */
const MAX_KORT = 1000;
const MAX_MOTEN = 5000;

const saknas = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|could not find/i.test(e.message ?? "");

const MANADER = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const UTFALL: Record<string, string> = { hallet: "Hållet", uteblev: "Uteblev", avbokat: "Avbokat" };
const RESULTAT: Record<string, string> = { affar: "Affär", nej: "Nej", offert: "Offert skickad", uppfoljning: "Uppföljning" };

type KortRad = {
  kedja_id: string;
  bolag_id: string;
  namn: string;
  kontakt: string | null;
  telefon: string | null;
  epost: string | null;
  doman: string | null;
  mote_id: string | null;
  mote_tid: string | null;
  langd_min: number | null;
  halls_av: string | null;
  bokat_av: string | null;
  bekraftat: boolean | null;
  antal_flyttningar: number | null;
  mal: string | null;
  nulage: string | null;
  uppfoljning_datum: string | null;
  uppfoljning_text: string | null;
  offert: boolean | null;
  inget_svar_i_rad: number | null;
  uppfoljning_andrad: string | null;
  deltagare: string[] | null;
  kolumn: string;
  idag: boolean | null;
};
type MoteRad = { id: string; kedja_id: string; mote_tid: string; utfall: string | null; resultat: string | null };
type FlodeRad = { id: string; event_id: string | null; kalla: string | null; bokat_nar: string; bekraftat_nar: string | null; flyttad_nar: string | null; forsok: number | null; senast_forsok: string | null };
type AvgjortRad = { id: string; kedja_id: string; mote_tid: string; utfall: string; niva: string | null; bokat_av: string; halls_av: string; bekraftat_nar: string | null };
type PersonRad = { id: string; first_name: string; last_name: string; employee_role: { role: string }[] | null };

/** Kortets plats ur kalenderhändelsen. Utan händelse är det Telefon, som Möten bokar som standard. */
function platsFor(e: { plats: string | null; online_url: string | null } | undefined): { typ: Platstyp; text: string; lank: string | null } {
  const lank = e?.online_url ?? null;
  const text = (e?.plats ?? "").trim() || MOTE_PLATS;
  return { typ: platsTyp(text, lank), text, lank };
}

/** "28 okt" ur en svensk lokal tid "2026-10-28 10:00". */
function dagManad(lokalTid: string): string {
  const [, m, d] = lokalTid.slice(0, 10).split("-").map(Number);
  return `${d} ${MANADER[m - 1]}`;
}

/** Historikens rad för ett avslutat möte: "28 okt · Uteblev", "30 okt · Hållet · Offert skickad". */
function historikRad(m: MoteRad): { id: string; tid: string; text: string } {
  const tid = lokal(m.mote_tid);
  const delar = [dagManad(tid), UTFALL[m.utfall ?? ""] ?? m.utfall ?? ""];
  if (m.resultat) delar.push(RESULTAT[m.resultat] ?? m.resultat);
  return { id: m.id, tid, text: delar.filter(Boolean).join(" · ") };
}

/** Veckans gränser: måndag 00:00 svensk tid till nästa måndag 00:00, som ISO. */
export function veckansGranser(nu: Date): { fran: string; till: string } {
  const idag = svensktDatum(nu);
  const mandag = dagarBakat(idag, svenskVeckodag(nu) - 1);
  const nastaMandag = svensktDatum(new Date(svenskTidpunkt(mandag, "12:00").getTime() + 7 * 24 * 3600_000));
  return { fran: svenskTidpunkt(mandag, "00:00").toISOString(), till: svenskTidpunkt(nastaMandag, "00:00").toISOString() };
}

export async function byggMoten(supabase: SupabaseClient, user: CurrentUser): Promise<NdMoten> {
  const chef = hasRole(user, ...CHEFSROLLER);
  const instTom = lasInstallningar([]);
  const tom: NdMoten = {
    kort: [], avgjorda: [], inst: { bekraftaDagar: instTom.bekraftaDagar, kolumnnamn: instTom.kolumnnamn, fragor: instTom.fragor },
    provisionPaSpel: null, vecka: { affar: 0, nej: 0, kedjor: [] }, saljare: [], kollegor: [], chef,
  };
  if (!user.employee) return tom;
  const jag = user.employee.id;
  const nu = new Date();
  const { fran, till } = veckansGranser(nu);
  // Månadens avgjorda: hämta ett något bredare fönster och välj ut månaden i installationens tidszon nedan.
  const manadFran = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - 1, 25)).toISOString();
  const manadTill = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() + 1, 2)).toISOString();

  const [kortSvar, veckaSvar, personSvar, instSvar, avgjortSvar] = await Promise.all([
    supabase.from("mote_kort").select("*").limit(MAX_KORT),
    supabase.from("mote_kedja_utfall").select("kedja_id, bolag_id, avslut, avslut_nar").in("avslut", ["affar", "nej"]).gte("avslut_nar", fran).lt("avslut_nar", till).limit(MAX_KORT),
    supabaseAdmin().from("employee").select("id, first_name, last_name, employee_role!employee_role_employee_id_fkey(role)").neq("status", "offboarded").limit(500),
    supabaseAdmin().from("nav_setting").select("key, value").like("key", "moten.%").limit(100),
    supabase
      .from("mote")
      .select("id, kedja_id, mote_tid, utfall, niva, bokat_av, halls_av, bekraftat_nar")
      .not("utfall", "is", null)
      .gte("mote_tid", manadFran)
      .lt("mote_tid", manadTill)
      .limit(MAX_MOTEN),
  ]);
  if (saknas(kortSvar.error)) return tom;
  const inst = lasInstallningar((instSvar.data ?? []) as { key: string; value: unknown }[]);
  const tz = inst.tidszon;
  const manad = manadFor(nu.toISOString(), tz);

  const rader = (kortSvar.data ?? []) as unknown as KortRad[];
  const personer = (personSvar.data ?? []) as unknown as PersonRad[];

  const saljare = personer
    .filter((p) => arHallare((p.employee_role ?? []).map((r) => r.role)))
    .map((p) => ({ id: p.id, namn: fullName(p) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
  const namn = new Map(personer.map((p) => [p.id, fullName(p)]));
  const kollegor = personer.map((p) => ({ id: p.id, namn: fullName(p) })).sort((a, b) => a.namn.localeCompare(b.namn, "sv"));

  // Den som bokat eller håller ett möte kan ha slutat: hämta de namn som saknas.
  const saknade = new Set<string>();
  // Månadens avgjorda möten (RLS: samma krets som tavlan). Före 0287 saknas `niva`; då är listan tom.
  const avgjortRader = ((avgjortSvar.error ? [] : avgjortSvar.data ?? []) as unknown as AvgjortRad[]).filter((m) => manadFor(m.mote_tid, tz) === manad);
  for (const r of rader) for (const id of [r.halls_av, r.bokat_av]) if (id && !namn.has(id)) saknade.add(id);
  for (const m of avgjortRader) for (const id of [m.halls_av, m.bokat_av]) if (id && !namn.has(id)) saknade.add(id);
  if (saknade.size) {
    const { data } = await supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...saknade]).limit(saknade.size);
    for (const p of (data ?? []) as unknown as PersonRad[]) namn.set(p.id, fullName(p));
  }

  // Historiken: kedjornas avslutade möten (utfall satt), äldst först. Det öppna mötet står redan i `mote`.
  const historik = new Map<string, { id: string; tid: string; text: string }[]>();
  if (rader.length) {
    const { data } = await supabase
      .from("mote")
      .select("id, kedja_id, mote_tid, utfall, resultat")
      .in("kedja_id", rader.map((r) => r.kedja_id))
      .not("utfall", "is", null)
      .order("mote_tid", { ascending: true })
      .limit(MAX_MOTEN);
    for (const m of (data ?? []) as unknown as MoteRad[]) {
      const rad = historikRad(m);
      historik.set(m.kedja_id, [...(historik.get(m.kedja_id) ?? []), rad]);
    }
  }

  // Vilka som är med på de öppna mötena: kalenderhändelsens deltagare. Kortet syns redan (RLS på mote_kort),
  // så service role här visar inget mer än mötet självt. Hållaren står i `hallsAv` och tas inte med.
  const narvaro = new Map<string, { med: { id: string; namn: string; svar: string }[]; gaster: { epost: string; svar: string }[] }>();
  // Källan står på mötesraden, platsen på kalenderhändelsen.
  const kallor = new Map<string, string>();
  const platser = new Map<string, { plats: string | null; online_url: string | null }>();
  const flode = new Map<string, FlodeRad>();
  const moteIds = rader.map((r) => r.mote_id).filter((x): x is string => !!x);
  if (moteIds.length) {
    // Bokningstiden, flyttiden och försöken (0287) står på mötesraden. Före 0287 räcker bokningstiden.
    let evSvar = await supabaseAdmin().from("mote").select("id, event_id, kalla, bokat_nar, bekraftat_nar, flyttad_nar, forsok, senast_forsok").in("id", moteIds).limit(MAX_KORT);
    if (saknas(evSvar.error)) evSvar = await supabaseAdmin().from("mote").select("id, event_id, kalla, bokat_nar, bekraftat_nar").in("id", moteIds).limit(MAX_KORT);
    const ev = evSvar.data;
    for (const x of (ev ?? []) as unknown as FlodeRad[]) {
      flode.set(x.id, x);
      if (x.kalla) kallor.set(x.id, x.kalla);
    }
    const tillMote = new Map(((ev ?? []) as { id: string; event_id: string | null }[]).filter((x) => x.event_id).map((x) => [x.event_id as string, x.id]));
    if (tillMote.size) {
      const [{ data: da }, { data: pl }] = await Promise.all([
        supabaseAdmin()
          .from("calendar_attendee")
          .select("event_id, employee_id, external_email, response")
          .in("event_id", [...tillMote.keys()])
          .limit(MAX_MOTEN),
        supabaseAdmin().from("calendar_event").select("id, plats, online_url").in("id", [...tillMote.keys()]).limit(MAX_KORT),
      ]);
      for (const e of (pl ?? []) as { id: string; plats: string | null; online_url: string | null }[]) {
        const id = tillMote.get(e.id);
        if (id) platser.set(id, { plats: e.plats, online_url: e.online_url });
      }
      const saknasNamn = new Set<string>();
      for (const a of (da ?? []) as { employee_id: string | null }[]) if (a.employee_id && !namn.has(a.employee_id)) saknasNamn.add(a.employee_id);
      if (saknasNamn.size) {
        const { data } = await supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...saknasNamn]).limit(saknasNamn.size);
        for (const p of (data ?? []) as unknown as PersonRad[]) namn.set(p.id, fullName(p));
      }
      for (const a of (da ?? []) as { event_id: string; employee_id: string | null; external_email: string | null; response: string | null }[]) {
        const id = tillMote.get(a.event_id);
        if (!id) continue;
        const n = narvaro.get(id) ?? { med: [], gaster: [] };
        if (a.employee_id) n.med.push({ id: a.employee_id, namn: namn.get(a.employee_id) ?? "Okänd", svar: a.response ?? "vantar" });
        else if (a.external_email) n.gaster.push({ epost: a.external_email, svar: a.response ?? "vantar" });
        narvaro.set(id, n);
      }
    }
  }

  const kort: NdMoteKort[] = rader.map((r) => {
    const f = r.mote_id ? flode.get(r.mote_id) : undefined;
    const oppet = !!(r.mote_id && r.mote_tid);
    const fonster = oppet
      ? bekraftelseFonster({ moteTid: r.mote_tid as string, senastAndrad: f?.flyttad_nar ?? f?.bokat_nar ?? (r.mote_tid as string), dagar: inst.bekraftaDagar, tz })
      : null;
    const fas = kortFas(
      { harOppetMote: oppet, mote: oppet ? { moteTid: r.mote_tid as string, langd: r.langd_min ?? 30, bekraftat: r.bekraftat === true, utfall: null } : null, fonster },
      nu,
      tz,
    );
    return {
    kedja: r.kedja_id,
    bolag: r.bolag_id,
    namn: r.namn,
    kontakt: r.kontakt,
    telefon: r.telefon,
    epost: r.epost,
    doman: r.doman,
    kolumn: (KOLUMNER as readonly string[]).includes(r.kolumn) ? (r.kolumn as Kolumn) : "folj_upp",
    idag: r.idag === true,
    fas,
    fonster,
    bradska: fonster ? bradska(fonster.senast, fas, nu, tz) : null,
    forsok: f?.forsok ?? 0,
    senastForsok: f?.senast_forsok ?? null,
    deltagare: r.deltagare ?? [],
    mote:
      r.mote_id && r.mote_tid
        ? {
            id: r.mote_id,
            tid: lokal(r.mote_tid),
            langd: r.langd_min ?? 30,
            hallsAv: r.halls_av ?? "",
            hallsAvNamn: namn.get(r.halls_av ?? "") ?? "",
            bokatAv: r.bokat_av ?? "",
            bokatAvNamn: namn.get(r.bokat_av ?? "") ?? "",
            bekraftat: r.bekraftat === true,
            bekraftatNar: f?.bekraftat_nar ? lokal(f.bekraftat_nar) : null,
            flyttningar: r.antal_flyttningar ?? 0,
            mal: r.mal,
            nulage: r.nulage,
            med: (narvaro.get(r.mote_id)?.med ?? []).filter((p) => p.id !== r.halls_av),
            gaster: narvaro.get(r.mote_id)?.gaster ?? [],
            kalla: kallor.get(r.mote_id) ?? "",
            plats: platsFor(platser.get(r.mote_id)),
          }
        : null,
    uppfoljning: r.uppfoljning_datum
      ? { datum: String(r.uppfoljning_datum).slice(0, 10), text: r.uppfoljning_text, offert: r.offert === true, ingetSvar: r.inget_svar_i_rad ?? 0, andrad: r.uppfoljning_andrad }
      : null,
    historik: historik.get(r.kedja_id) ?? [],
    };
  });

  // Fast ordning: kolumnerna som på tavlan, inom kolumnen efter tid (Avgjort: senaste först). Uppföljningen
  // sorteras på sitt datum, och Följ upp före Tyst som förr.
  const sort = (k: NdMoteKort) => k.mote?.tid ?? k.uppfoljning?.datum ?? "9999";
  kort.sort(
    (a, b) =>
      sorteraFas({ fas: a.fas, tid: sort(a) }, { fas: b.fas, tid: sort(b) })
      || KOLUMNER.indexOf(a.kolumn) - KOLUMNER.indexOf(b.kolumn)
      || a.namn.localeCompare(b.namn, "sv"),
  );

  // Månadens avgjorda: bolagets namn och kedjans deltagare läses som den inloggade (RLS), betraktarens låsta belopp ur mote_provision.
  const avgjorda: NdAvgjort[] = [];
  if (avgjortRader.length) {
    const kedjeIds = [...new Set(avgjortRader.map((m) => m.kedja_id))];
    const [{ data: kd }, { data: pv }] = await Promise.all([
      supabase.from("mote_kedja").select("id, bolag_id, deltagare").in("id", kedjeIds).limit(MAX_KORT),
      supabase.from("mote_provision").select("mote_id, belopp, skal").eq("employee_id", jag).in("mote_id", avgjortRader.map((m) => m.id)).limit(MAX_MOTEN),
    ]);
    const kedjor = new Map(((kd ?? []) as { id: string; bolag_id: string; deltagare: string[] | null }[]).map((k) => [k.id, k]));
    const { data: bd } = await supabase.from("mote_bolag").select("id, namn").in("id", [...new Set([...kedjor.values()].map((k) => k.bolag_id))]).limit(MAX_KORT);
    const bolagNamnA = new Map(((bd ?? []) as { id: string; namn: string }[]).map((b) => [b.id, b.namn]));
    const prov = new Map(((pv ?? []) as { mote_id: string; belopp: number | string; skal: string | null }[]).map((p) => [p.mote_id, p]));
    for (const m of avgjortRader) {
      const k = kedjor.get(m.kedja_id);
      const p = prov.get(m.id);
      avgjorda.push({
        mote: m.id,
        kedja: m.kedja_id,
        namn: (k && bolagNamnA.get(k.bolag_id)) ?? "Bolaget",
        tid: lokal(m.mote_tid),
        utfall: m.utfall as NdAvgjort["utfall"],
        niva: m.niva === "kvalificerat" || m.niva === "hallet" ? m.niva : null,
        vantarBedomning: m.utfall === "hallet" && !m.niva && !!inst.gallerFran && new Date(m.mote_tid).getTime() >= Date.parse(inst.gallerFran),
        bekraftat: !!m.bekraftat_nar,
        hallsAv: m.halls_av,
        hallsAvNamn: namn.get(m.halls_av) ?? "",
        bokatAv: m.bokat_av,
        bokatAvNamn: namn.get(m.bokat_av) ?? "",
        deltagare: k?.deltagare ?? [m.bokat_av, m.halls_av],
        belopp: p ? Number(p.belopp) : null,
        skal: p?.skal ?? null,
      });
    }
    avgjorda.sort((a, b) => b.tid.localeCompare(a.tid));
  }

  // Provision på spel: bara för den som får mötesprovision. Öppna kolumner räknas med dagens satser och
  // kvalificerat belopp (det möjliga), Avgjort med betraktarens låsta belopp i månaden.
  let provisionPaSpel: NdMoten["provisionPaSpel"] = null;
  if (inst.mottagare.includes(jag)) {
    const paSpel = Object.fromEntries(PIPE_KOLUMNER.map((k) => [k, 0])) as Record<PipeKolumn, number>;
    const oppna = kort.filter((k) => k.mote && k.fas !== "avgjort");
    if (oppna.length) {
      const { data: km } = await supabaseAdmin()
        .from("mote")
        .select("id, art, foregaende_id, bokat_av")
        .in("kedja_id", [...new Set(oppna.map((k) => k.kedja))])
        .limit(MAX_MOTEN);
      const karta = new Map(((km ?? []) as { id: string; art: string; foregaende_id: string | null; bokat_av: string }[]).map((m) => [m.id, { art: m.art, foregaende: m.foregaende_id, bokatAv: m.bokat_av }]));
      for (const k of oppna) {
        const m = k.mote!;
        const ursprunglig = ursprungligBokare(m.id, karta);
        if (!ursprunglig) continue;
        const andel = fordela({ ursprunglig, bokatAv: m.bokatAv, hallsAv: m.hallsAv, mottagare: inst.mottagare, regel: inst.ombokning, belopp: inst.satser.kvalificerat })
          .find((a) => a.employeeId === jag);
        if (andel) paSpel[k.fas] += andel.belopp;
      }
    }
    paSpel.avgjort = avgjorda.reduce((s, a) => s + (a.belopp ?? 0), 0);
    for (const k of PIPE_KOLUMNER) paSpel[k] = Math.round(paSpel[k] * 100) / 100;
    provisionPaSpel = paSpel;
  }

  // Veckans stängda kedjor: räknetalen och listan bakom dem (ett klick på raden överst). Bolagets namn läses som den inloggade (RLS).
  type VeckaRad = { kedja_id: string; bolag_id: string; avslut: string; avslut_nar: string | null };
  const vRader = ((veckaSvar.error ? [] : veckaSvar.data ?? []) as unknown as VeckaRad[]).filter((v) => v.avslut === "affar" || v.avslut === "nej");
  const bolagNamn = new Map<string, string>();
  if (vRader.length) {
    const { data: bolag } = await supabase.from("mote_bolag").select("id, namn").in("id", [...new Set(vRader.map((v) => v.bolag_id))]).limit(MAX_KORT);
    for (const b of (bolag ?? []) as unknown as { id: string; namn: string }[]) bolagNamn.set(b.id, b.namn);
  }
  const vecka: NdMoten["vecka"] = { affar: 0, nej: 0, kedjor: [] };
  for (const v of vRader) {
    if (v.avslut === "affar") vecka.affar++;
    else vecka.nej++;
    vecka.kedjor.push({ kedja: v.kedja_id, namn: bolagNamn.get(v.bolag_id) ?? "Bolaget", avslut: v.avslut as "affar" | "nej", nar: v.avslut_nar ? lokal(v.avslut_nar) : "" });
  }
  vecka.kedjor.sort((a, b) => b.nar.localeCompare(a.nar));

  return {
    kort,
    avgjorda,
    inst: { bekraftaDagar: inst.bekraftaDagar, kolumnnamn: inst.kolumnnamn, fragor: inst.fragor },
    provisionPaSpel,
    vecka,
    saljare,
    kollegor,
    chef,
  };
}
