import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { initials, type CurrentUser } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { hamtaDelningar, hamtaEgenKalender, hamtaKollegasKalender } from "@/lib/kalender-server";
import { arDelningsniva, type Delningsniva, type Kalenderpost } from "@/lib/kalender";
import { svensktDatum } from "@/lib/klocka";
import { hamtaMal } from "@/lib/saljmal-server";
import { malFor } from "@/lib/saljtakt";
import { kvPerOmrade, arChefFor } from "@/lib/coachning-server";
import { hamtaProvision } from "@/lib/provision-server";
import {
  LK_FEL,
  avatarfarg,
  felkod,
  hemdag,
  intervallForVy,
  minuter,
  plus,
  type Post,
  type Slag,
  type Svar,
  type Upptaget,
  type Vy,
} from "@/lib/leveranskalender";

/**
 * Leveranskalenderns läsning och anropen till `lk_*` (0069).
 *
 * =============================================================================
 * TVÅ KÄLLOR I VARJE KALENDER, OCH INGEN AV DEM SKRIVS OM HÄR
 *
 * Det navet redan vet — uppgifter, ledighet, coachning, frister — läses som
 * förut, genom `hamtaEgenKalender()` för den egna och `hamtaKollegasKalender()`
 * för en kollegas. Mötena läses genom `kalender_handelser()`, som projicerar
 * dem till läsarens nivå i DEN PERSONENS kalender innan de lämnar databasen.
 *
 * Här sätts de bara ihop till samma sorts post, så att rutnätet har en typ att
 * rita. Ingen behörighetsfråga besvaras i den här filen.
 * =============================================================================
 */

export type Person = {
  id: string;
  namn: string;
  fornamn: string;
  kort: string;
  /** 1–6, `--color-av-N`. */
  farg: number;
  grupp: "salj" | "lev" | "ovr";
  roll: string;
  /** Min nivå i personens kalender. `delegat` för mig själv. */
  niva: Delningsniva;
};

export type Lkdata = {
  mig: string;
  idag: string;
  vy: Vy;
  anchor: string;
  personer: Person[];
  /** Kalendrar som visas utöver min egen. */
  visa: string[];
  poster: Post[];
  /** Obesvarade inbjudningar från idag och framåt. */
  vantar: number;
  /** Dagen sammanfattningsraden räknar på (`HOME`): idag, eller måndagen efter en helg. */
  hem: string;
  /** Mina poster den dagen, även när vyn visar en annan vecka. */
  hemPoster: Post[];
};

const SALJ: Role[] = ["salesperson", "sales_manager", "team_lead"];
const LEV: Role[] = ["delivery", "project_manager"];

/** Alla aktiva, med min nivå i var och ens kalender. */
export async function hamtaPersoner(user: CurrentUser): Promise<Person[]> {
  if (!user.employee) return [];
  const mig = user.employee.id;
  const db = supabaseAdmin();

  const [{ data: rader }, { data: roller }, delningar] = await Promise.all([
    db.from("employee").select("id, first_name, last_name").neq("status", "offboarded").order("first_name"),
    db.from("employee_role").select("employee_id, role"),
    hamtaDelningar(user),
  ]);

  const rollerPer = new Map<string, Role[]>();
  for (const r of (roller ?? []) as { employee_id: string; role: Role }[]) {
    rollerPer.set(r.employee_id, [...(rollerPer.get(r.employee_id) ?? []), r.role]);
  }
  const niva = new Map(delningar.inat.map((i) => [i.employee_id, i.niva]));

  return ((rader ?? []) as { id: string; first_name: string; last_name: string }[]).map((e) => {
    const r = rollerPer.get(e.id) ?? [];
    const grupp = r.some((x) => SALJ.includes(x)) ? "salj" : r.some((x) => LEV.includes(x)) ? "lev" : "ovr";
    const huvudroll =
      (["sales_manager", "team_lead", "project_manager", "delivery", "salesperson", "ceo", "finance", "admin"] as Role[]).find(
        (x) => r.includes(x),
      ) ?? null;
    return {
      id: e.id,
      namn: `${e.first_name} ${e.last_name}`.trim(),
      fornamn: e.first_name,
      kort: initials(e),
      farg: avatarfarg(e.id),
      grupp,
      roll: huvudroll ? ROLE_LABEL[huvudroll] : "",
      niva: e.id === mig ? "delegat" : (niva.get(e.id) ?? "upptagen"),
    } satisfies Person;
  });
}

/** Navets andra källor, som poster i leveranskalendern. */
function franKalenderpost(p: Kalenderpost, agare: string): Post {
  const slag: Slag =
    p.slag === "uppgift"
      ? "uppgift"
      : p.slag === "coachning" || p.slag === "coachningsuppgift"
        ? "coachning"
        : p.slag === "franvaro"
          ? "ledig"
          : p.slag === "order"
            ? "order"
            : "frist";
  const start = minuter(p.tid);
  return {
    id: `${agare}:${p.id}`,
    ref: p.ref,
    slag,
    agare,
    dag: p.dag,
    start,
    // Ett klockslag utan uppskattning ritas som en halvtimme, som i Planeringsvyn.
    minuter: start === null ? p.minuter : (p.minuter ?? 30),
    rubrik: p.rubrik,
    svar: slag === "uppgift" ? "org" : null,
    klar: p.klar,
    href: p.href,
    organisator: agare,
    deltagare: [],
    serie: false,
    serieId: null,
    paminnelse: 10,
  };
}

type Handelserad = {
  ref: string | null;
  slag: string | null;
  dag: string;
  tid: string | null;
  minuter: number | null;
  rubrik: string | null;
  organizer_id: string | null;
  svar: string;
  series_id: string | null;
  show_as: string;
  step: string | null;
  outcome: string | null;
  attempt: number;
  reminder_min: number;
  niva: string;
};

async function handelserFor(agare: string, fran: string, till: string): Promise<Post[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("kalender_handelser", { p_owner: agare, p_fran: fran, p_till: till });
  if (error || !data) return [];
  return (data as unknown as Handelserad[]).map((r, i) => ({
    id: `${agare}:mote:${r.ref ?? `${r.dag}-${r.tid}-${i}`}`,
    ref: r.ref,
    slag: (r.slag === "enskilt" ? "enskilt" : r.slag === "leverans" ? "leverans" : "mote") as Slag,
    agare,
    dag: r.dag,
    start: minuter(r.tid),
    minuter: r.minuter,
    rubrik: r.rubrik,
    svar: (r.svar as Svar) ?? null,
    klar: r.outcome === "genomford",
    href: null,
    organisator: r.organizer_id,
    deltagare: [],
    serie: r.series_id !== null,
    serieId: r.series_id,
    paminnelse: r.reminder_min ?? 10,
  }));
}

/**
 * Allt vyn ritar: min kalender och de kollegors jag kryssat i.
 *
 * Samma möte i två kalendrar står EN gång. Det står i den första kalendern det
 * hittas i — min egen före kollegornas — eftersom mitt svar är det som avgör
 * hur det ritas för mig.
 */
export async function hamtaLeveranskalender(
  user: CurrentUser,
  vy: Vy,
  anchor: string,
  visa: string[],
  idag: string,
): Promise<Lkdata | null> {
  if (!user.employee) return null;
  const mig = user.employee.id;
  const { fran, till } = intervallForVy(vy, anchor);

  const personer = await hamtaPersoner(user);
  const kanda = new Set(personer.map((p) => p.id));
  const andra = [...new Set(visa)].filter((id) => id !== mig && kanda.has(id)).slice(0, 12);

  const [egen, egnaMoten, kollegor, vantar] = await Promise.all([
    hamtaEgenKalender(user, fran, till),
    handelserFor(mig, fran, till),
    Promise.all(
      andra.map(async (id) => {
        const [k, m] = await Promise.all([hamtaKollegasKalender(user, id, fran, till), handelserFor(id, fran, till)]);
        return [...(k?.poster ?? []).map((p) => franKalenderpost(p, id)), ...m];
      }),
    ),
    obesvarade(mig, idag),
  ]);

  const alla: Post[] = [...egen.poster.map((p) => franKalenderpost(p, mig)), ...egnaMoten, ...kollegor.flat()];

  const sedda = new Set<string>();
  const poster = alla.filter((p) => {
    if (p.slag !== "mote" && p.slag !== "enskilt" && p.slag !== "leverans") return true;
    if (!p.ref) return true;
    if (sedda.has(p.ref)) return false;
    sedda.add(p.ref);
    return true;
  });

  await fyllDeltagare(poster);

  // Sammanfattningsraden gäller alltid `HOME`, som i prototypen. Ligger den
  // utanför vyns vecka hämtas den dagen för sig — annars hade raden bytt
  // innebörd när man bläddrar.
  const hem = hemdag(idag);
  const hemPoster =
    hem >= fran && hem <= till
      ? poster.filter((p) => p.agare === mig && p.dag === hem)
      : [
          ...(await hamtaEgenKalender(user, hem, hem)).poster.map((p) => franKalenderpost(p, mig)),
          ...(await handelserFor(mig, hem, hem)),
        ];

  return { mig, idag, vy, anchor, personer, visa: andra, poster, vantar, hem, hemPoster };
}

/**
 * Deltagarna på de möten läsaren får öppna — för avatarerna, 1:1-rubriken och
 * sökningen. En förekomst i en serie har seriens deltagare plus sina egna rader.
 */
async function fyllDeltagare(poster: Post[]): Promise<void> {
  const moten = poster.filter((p) => p.ref && (p.slag === "mote" || p.slag === "enskilt"));
  const refs = [...new Set(moten.map((p) => p.ref!))];
  const serier = [...new Set(moten.map((p) => p.serieId).filter((x): x is string => !!x))];
  if (refs.length === 0) return;
  const supabase = await supabaseServer();
  const [{ data: egna }, { data: seriens }] = await Promise.all([
    supabase.from("calendar_attendee").select("event_id, employee_id").in("event_id", refs).not("employee_id", "is", null),
    serier.length
      ? supabase.from("calendar_attendee").select("series_id, employee_id").in("series_id", serier).not("employee_id", "is", null)
      : Promise.resolve({ data: [] as { series_id: string; employee_id: string }[] }),
  ]);
  const per = new Map<string, Set<string>>();
  const lagg = (nyckel: string, id: string) => per.set(nyckel, (per.get(nyckel) ?? new Set()).add(id));
  for (const r of (egna ?? []) as { event_id: string; employee_id: string }[]) lagg(`e:${r.event_id}`, r.employee_id);
  for (const r of (seriens ?? []) as { series_id: string; employee_id: string }[]) lagg(`s:${r.series_id}`, r.employee_id);
  for (const p of moten) {
    const alla = new Set([...(per.get(`e:${p.ref}`) ?? []), ...(p.serieId ? per.get(`s:${p.serieId}`) ?? [] : [])]);
    if (alla.size === 0) continue;
    p.deltagare = [...(p.organisator ? [p.organisator] : []), ...[...alla].filter((id) => id !== p.organisator)];
  }
}

/** Hur många inbjudningar som väntar på mitt svar, från idag. */
async function obesvarade(mig: string, idag: string): Promise<number> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("calendar_attendee")
    .select("event_id, calendar_event!inner(dag, cancelled_at)")
    .eq("employee_id", mig)
    .eq("response", "vantar")
    .gte("calendar_event.dag", idag)
    .is("calendar_event.cancelled_at", null);
  return (data ?? []).length;
}

/**
 * Upptagen tid för assistenten, krockvarningen och "Föreslå tid".
 *
 * Genom samma två projektioner som kalendern: `kalender_poster()` för
 * uppgifter och ledighet, `kalender_handelser()` för möten. Läsaren får alltså
 * aldrig veta mer än att tiden är tagen — rubrikerna lämnas inte ens ut hit.
 */
export async function upptagetFor(
  user: CurrentUser,
  personer: string[],
  fran: string,
  till: string,
): Promise<Upptaget> {
  const ut: Upptaget = {};
  if (!user.employee) return ut;
  const supabase = await supabaseServer();
  const unika = [...new Set(personer)].slice(0, 20);

  await Promise.all(
    unika.map(async (p) => {
      const [{ data: poster }, { data: moten }] = await Promise.all([
        supabase.rpc("kalender_poster", { p_owner: p, p_fran: fran, p_till: till }),
        supabase.rpc("kalender_handelser", { p_owner: p, p_fran: fran, p_till: till }),
      ]);
      const dagar: Upptaget[string] = {};
      const dagen = (d: string) => (dagar[d] ??= { block: [], ledig: false });

      for (const r of (poster ?? []) as { slag: string; ref: string | null; dag: string; tid: string | null; minuter: number | null; klar: boolean }[]) {
        if (r.slag === "franvaro") {
          // En del av dagen utan klockslag: navet vet inte vilka timmar, så
          // dagen räknas inte som ledig. Hela dagen är ledig.
          if (!r.minuter) dagen(r.dag).ledig = true;
          continue;
        }
        const s = minuter(r.tid);
        if (s === null || r.klar) continue;
        dagen(r.dag).block.push({ s, e: s + Math.max(15, r.minuter ?? 30), id: r.ref });
      }
      for (const r of (moten ?? []) as unknown as Handelserad[]) {
        const s = minuter(r.tid);
        if (s === null || r.svar === "nej" || r.show_as === "ledig") continue;
        dagen(r.dag).block.push({ s, e: s + Math.max(15, r.minuter ?? 30), id: r.ref });
      }
      ut[p] = dagar;
    }),
  );

  return ut;
}

export type Deltagarrad = {
  id: string;
  svar: Exclude<Svar, "org">;
  forslag: { dag: string; start: number; minuter: number; note: string | null } | null;
  note: string | null;
  /** Raden hör till just den här förekomsten, inte till serien. */
  egenRad: boolean;
};

export type Serieinfo = {
  id: string;
  monster: "vardagar" | "veckovis";
  intervall: number;
  veckodag: number | null;
  starts_on: string;
  ends_on: string | null;
};

export type Handelsedetalj = {
  id: string;
  slag: Slag;
  rubrik: string;
  dag: string;
  start: number | null;
  minuter: number | null;
  organisator: string;
  plats: string | null;
  onlineUrl: string | null;
  agenda: string;
  paminnelse: number;
  installd: boolean;
  serie: Serieinfo | null;
  /** Förekomsten är flyttad för sig och har egna svar. */
  avviker: boolean;
  coachningssamtal: string | null;
  deltagare: Deltagarrad[];
  /** Mitt svar, eller `org`, eller null om jag inte är med. */
  mittSvar: Svar | null;
  /** Mitt svar gäller hela serien (ingen egen rad på förekomsten). */
  svarGallerSerien: boolean;
  /** Organisatören, eller den som har "kan planera om" hos henne. */
  farAndra: boolean;
};

type Attendeerad = {
  employee_id: string;
  response: Deltagarrad["svar"];
  response_note: string | null;
  proposed_dag: string | null;
  proposed_tid: string | null;
  proposed_minuter: number | null;
  proposal_note: string | null;
};

/**
 * En händelse i sin helhet, för panelen. Med läsarens egen token: RLS i 0069
 * släpper fram raden bara till den som får se den med detaljer.
 *
 * En förekomst i en serie har seriens deltagare, och förekomstens egna rader
 * går före — samma regel som `lk_narvaro()` i databasen.
 */
export async function hamtaHandelsedetalj(user: CurrentUser, id: string): Promise<Handelsedetalj | null> {
  if (!user.employee || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [{ data: e }, { data: egna }] = await Promise.all([
    supabase
      .from("calendar_event")
      .select("id, kind, title, dag, tid, minuter, organizer_id, plats, online_url, agenda_md, reminder_min, cancelled_at, series_id, avviker, coaching_session_id")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("calendar_attendee")
      .select("employee_id, response, response_note, proposed_dag, proposed_tid, proposed_minuter, proposal_note")
      .eq("event_id", id)
      .not("employee_id", "is", null),
  ]);
  if (!e) return null;

  const serieId = (e.series_id as string | null) ?? null;
  const [{ data: s }, { data: seriens }] = serieId
    ? await Promise.all([
        supabase.from("calendar_series").select("id, monster, intervall, veckodag, starts_on, ends_on").eq("id", serieId).maybeSingle(),
        supabase
          .from("calendar_attendee")
          .select("employee_id, response, response_note, proposed_dag, proposed_tid, proposed_minuter, proposal_note")
          .eq("series_id", serieId)
          .not("employee_id", "is", null),
      ])
    : [{ data: null }, { data: [] }];

  const tillRad = (r: Attendeerad, egenRad: boolean): Deltagarrad => ({
    id: r.employee_id,
    svar: r.response,
    note: r.response_note,
    egenRad,
    forslag:
      r.proposed_dag && r.proposed_tid && r.proposed_minuter
        ? { dag: r.proposed_dag, start: minuter(r.proposed_tid)!, minuter: r.proposed_minuter, note: r.proposal_note }
        : null,
  });
  const egnaRader = ((egna ?? []) as unknown as Attendeerad[]).map((r) => tillRad(r, true));
  const harEgen = new Set(egnaRader.map((d) => d.id));
  const deltagare = [
    ...egnaRader,
    ...((seriens ?? []) as unknown as Attendeerad[]).filter((r) => !harEgen.has(r.employee_id)).map((r) => tillRad(r, false)),
  ];

  const organisator = e.organizer_id as string;
  let farAndra = organisator === mig;
  if (!farAndra) {
    const { data: niva } = await supabase.rpc("kalender_niva", { p_owner: organisator, p_viewer: mig });
    farAndra = arDelningsniva(niva) && (niva === "redigera" || niva === "delegat");
  }
  const min = deltagare.find((d) => d.id === mig);

  return {
    id: e.id as string,
    slag: (e.kind === "enskilt" ? "enskilt" : e.kind === "leverans" ? "leverans" : "mote") as Slag,
    rubrik: e.title as string,
    dag: e.dag as string,
    start: minuter(e.tid as string | null),
    minuter: e.minuter as number | null,
    organisator,
    plats: e.plats as string | null,
    onlineUrl: e.online_url as string | null,
    agenda: (e.agenda_md as string) ?? "",
    paminnelse: e.reminder_min as number,
    installd: e.cancelled_at !== null,
    serie: s ? (s as unknown as Serieinfo) : null,
    avviker: Boolean(e.avviker),
    coachningssamtal: (e.coaching_session_id as string | null) ?? null,
    deltagare,
    mittSvar: organisator === mig ? "org" : (min?.svar ?? null),
    svarGallerSerien: !!serieId && !!min && !min.egenRad,
    farAndra,
  };
}

// -----------------------------------------------------------------------------
// 1:1-innehållet (pass 2)
// -----------------------------------------------------------------------------

export type Punkt = {
  id: string;
  kind: "agenda" | "atgard";
  text: string;
  author: string;
  owner: string | null;
  klar: boolean;
  uppgift: string | null;
};

export type Enskilt = {
  seriesId: string;
  saljare: string;
  /** Punkterna, om läsaren är i kretsen (RLS). Null = utanför. */
  punkter: Punkt[] | null;
  /** Säljaren eller den som håller samtalet: får skriva. */
  farSkriva: boolean;
  /** Håller samtalet och är säljarens chef: får spara som coachningssamtal. */
  farCoacha: boolean;
  siffror: { order: number | null; mal: number | null; kv: string | null; provision: number | null };
};

/**
 * En 1:1:s innehåll. Punkterna läses med läsarens token: policyn i 0069 är
 * coachningskretsen, och den som står utanför får noll rader — då är
 * `punkter` null och panelen säger det rakt ut.
 *
 * Säljarens siffror läses också med läsarens egen token, genom modulernas egna
 * läsningar. Får läsaren inte se dem står "–" — ingen siffra läses förbi RLS.
 */
export async function hamtaEnskilt(user: CurrentUser, e: Handelsedetalj): Promise<Enskilt | null> {
  if (!user.employee || e.slag !== "enskilt" || !e.serie) return null;
  const mig = user.employee.id;
  const saljare = e.deltagare[0]?.id ?? null;
  if (!saljare) return null;
  const supabase = await supabaseServer();
  const manad = `${svensktDatum().slice(0, 7)}-01`;

  const [{ data: punkter, error }, { count: order }, mal, kv, provision, chef] = await Promise.all([
    supabase
      .from("one_on_one_item")
      .select("id, kind, text, author_id, owner_id, done_at, task_id, created_at")
      .eq("series_id", e.serie.id)
      .order("created_at"),
    supabase
      .from("sales_order")
      .select("id", { count: "exact", head: true })
      .eq("salesperson_id", saljare)
      .eq("period_month", manad)
      .in("status", ["signerad", "betald"]),
    hamtaMal(manad).then((m) => malFor(m, saljare, manad)?.mal_order ?? null).catch(() => null),
    kvPerOmrade(saljare)
      .then((omr) => {
        const v = omr.map((o) => o.senaste).filter((x): x is number => typeof x === "number");
        return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).replace(".", ",") : null;
      })
      .catch(() => null),
    hamtaProvision(saljare, manad)
      .then((p) => {
        const denna = p.filter((x) => String(x.period_month).slice(0, 10) === manad);
        return denna.length ? denna.reduce((a, x) => a + Number(x.amount), 0) : null;
      })
      .catch(() => null),
    e.organisator === mig ? arChefFor(user, saljare).catch(() => false) : Promise.resolve(false),
  ]);

  const rader = ((punkter ?? []) as unknown as {
    id: string;
    kind: "agenda" | "atgard";
    text: string;
    author_id: string;
    owner_id: string | null;
    done_at: string | null;
    task_id: string | null;
  }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    author: r.author_id,
    owner: r.owner_id,
    klar: r.done_at !== null,
    uppgift: r.task_id,
  }));

  const iParet = mig === e.organisator || mig === saljare;
  return {
    seriesId: e.serie.id,
    saljare,
    punkter: error || (!iParet && rader.length === 0) ? (iParet ? [] : null) : rader,
    farSkriva: iParet,
    farCoacha: Boolean(chef),
    siffror: { order: order ?? null, mal, kv, provision },
  };
}

// -----------------------------------------------------------------------------
// Skrivningen
// -----------------------------------------------------------------------------

export type LkSvar<T> = { ok: true; data: T } | { ok: false; fel: string };

/**
 * Ett anrop till en `lk_*`-funktion. Bara service role får göra det (0069).
 * Felkoden översätts till prototypens text; ett okänt fel ges som det är, så
 * att det syns och inte döljs bakom en allmän mening.
 */
export async function lk<T>(funktion: string, args: Record<string, unknown>): Promise<LkSvar<T>> {
  const { data, error } = await supabaseAdmin().rpc(funktion, args);
  if (error) {
    const kod = felkod(error.message);
    return { ok: false, fel: kod ? LK_FEL[kod] : `Gick inte att spara: ${error.message}` };
  }
  return { ok: true, data: data as T };
}

/** Förnamn för kvittona. */
export async function fornamn(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin().from("employee").select("id, first_name").in("id", [...new Set(ids)]);
  return new Map(((data ?? []) as { id: string; first_name: string }[]).map((r) => [r.id, r.first_name]));
}

/** Dag och sju framåt, för en sökning eller ett förslag. */
export function fonsterFran(dag: string, dagar: number): { fran: string; till: string } {
  return { fran: dag, till: plus(dag, dagar) };
}
