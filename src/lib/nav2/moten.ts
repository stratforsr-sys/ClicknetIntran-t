import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dagarBakat, svenskTidpunkt, svenskVeckodag, svensktDatum } from "@/lib/klocka";
import { lokal } from "./leads";
import { arHallare, KOLUMNER, type Kolumn } from "./motenforma";

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
    flyttningar: number;
    mal: string | null;
    nulage: string | null;
  } | null;
  uppfoljning: { datum: string; text: string | null; offert: boolean; ingetSvar: number; andrad: string | null } | null;
  historik: { tid: string; text: string }[];
};

export type NdMoten = {
  kort: NdMoteKort[];
  vecka: { affar: number; nej: number; kedjor: { kedja: string; namn: string; avslut: "affar" | "nej"; nar: string }[] };
  saljare: { id: string; namn: string }[];
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
type MoteRad = { kedja_id: string; mote_tid: string; utfall: string | null; resultat: string | null };
type PersonRad = { id: string; first_name: string; last_name: string; employee_role: { role: string }[] | null };

/** "28 okt" ur en svensk lokal tid "2026-10-28 10:00". */
function dagManad(lokalTid: string): string {
  const [, m, d] = lokalTid.slice(0, 10).split("-").map(Number);
  return `${d} ${MANADER[m - 1]}`;
}

/** Historikens rad för ett avslutat möte: "28 okt · Uteblev", "30 okt · Hållet · Offert skickad". */
function historikRad(m: MoteRad): { tid: string; text: string } {
  const tid = lokal(m.mote_tid);
  const delar = [dagManad(tid), UTFALL[m.utfall ?? ""] ?? m.utfall ?? ""];
  if (m.resultat) delar.push(RESULTAT[m.resultat] ?? m.resultat);
  return { tid, text: delar.filter(Boolean).join(" · ") };
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
  const tom: NdMoten = { kort: [], vecka: { affar: 0, nej: 0, kedjor: [] }, saljare: [], chef };
  if (!user.employee) return tom;
  const nu = new Date();
  const { fran, till } = veckansGranser(nu);

  const [kortSvar, veckaSvar, personSvar] = await Promise.all([
    supabase.from("mote_kort").select("*").limit(MAX_KORT),
    supabase.from("mote_kedja_utfall").select("kedja_id, bolag_id, avslut, avslut_nar").in("avslut", ["affar", "nej"]).gte("avslut_nar", fran).lt("avslut_nar", till).limit(MAX_KORT),
    supabaseAdmin().from("employee").select("id, first_name, last_name, employee_role!employee_role_employee_id_fkey(role)").neq("status", "offboarded").limit(500),
  ]);
  if (saknas(kortSvar.error)) return tom;

  const rader = (kortSvar.data ?? []) as unknown as KortRad[];
  const personer = (personSvar.data ?? []) as unknown as PersonRad[];

  const saljare = personer
    .filter((p) => arHallare((p.employee_role ?? []).map((r) => r.role)))
    .map((p) => ({ id: p.id, namn: fullName(p) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
  const namn = new Map(personer.map((p) => [p.id, fullName(p)]));

  // Den som bokat eller håller ett möte kan ha slutat: hämta de namn som saknas.
  const saknade = new Set<string>();
  for (const r of rader) for (const id of [r.halls_av, r.bokat_av]) if (id && !namn.has(id)) saknade.add(id);
  if (saknade.size) {
    const { data } = await supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...saknade]).limit(saknade.size);
    for (const p of (data ?? []) as unknown as PersonRad[]) namn.set(p.id, fullName(p));
  }

  // Historiken: kedjornas avslutade möten (utfall satt), äldst först. Det öppna mötet står redan i `mote`.
  const historik = new Map<string, { tid: string; text: string }[]>();
  if (rader.length) {
    const { data } = await supabase
      .from("mote")
      .select("kedja_id, mote_tid, utfall, resultat")
      .in("kedja_id", rader.map((r) => r.kedja_id))
      .not("utfall", "is", null)
      .order("mote_tid", { ascending: true })
      .limit(MAX_MOTEN);
    for (const m of (data ?? []) as unknown as MoteRad[]) {
      const rad = historikRad(m);
      historik.set(m.kedja_id, [...(historik.get(m.kedja_id) ?? []), rad]);
    }
  }

  const kort: NdMoteKort[] = rader.map((r) => ({
    kedja: r.kedja_id,
    bolag: r.bolag_id,
    namn: r.namn,
    kontakt: r.kontakt,
    telefon: r.telefon,
    epost: r.epost,
    doman: r.doman,
    kolumn: (KOLUMNER as readonly string[]).includes(r.kolumn) ? (r.kolumn as Kolumn) : "folj_upp",
    idag: r.idag === true,
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
            flyttningar: r.antal_flyttningar ?? 0,
            mal: r.mal,
            nulage: r.nulage,
          }
        : null,
    uppfoljning: r.uppfoljning_datum
      ? { datum: String(r.uppfoljning_datum).slice(0, 10), text: r.uppfoljning_text, offert: r.offert === true, ingetSvar: r.inget_svar_i_rad ?? 0, andrad: r.uppfoljning_andrad }
      : null,
    historik: historik.get(r.kedja_id) ?? [],
  }));

  // Fast ordning: kolumnerna som på tavlan, sedan det som ligger närmast i tid.
  const sort = (k: NdMoteKort) => k.mote?.tid ?? k.uppfoljning?.datum ?? "9999";
  kort.sort((a, b) => KOLUMNER.indexOf(a.kolumn) - KOLUMNER.indexOf(b.kolumn) || sort(a).localeCompare(sort(b)) || a.namn.localeCompare(b.namn, "sv"));

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

  return { kort, vecka, saljare, chef };
}
