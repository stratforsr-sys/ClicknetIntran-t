import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { lasSidvis } from "@/lib/sidvis";
import { dagensRam, type NdDag, type RastRad, type SchemaRad } from "./hemdag";
import { harGodkants, nettoAntal, ordervarde, type Order } from "@/lib/order";
import { SKRIVLAGE } from "./skrivlage";
import { vapidPublik } from "./push";
import { byggForslag, lasInst, lasKrets, type NdForslag } from "./forslag";
import type { ForslagInst } from "./forslagforma";
import { nivaFor } from "./forma";
import { byggTeam, lagenJagLeder, type LettLag, type NdTeam } from "./hem-team";
import { INST_FORVAL, lokalDag } from "./motesflode";
import { kretsFor } from "./motesstatforma";
import { textLagnamn } from "./hemtext";
import { chattLage, type ChattLage } from "./chatt/logg";

/**
 * Nav 2.0: startsidan.
 *
 * Startsidan sammanfattar andra vyer, och nästan allt den visar läser klienten
 * ur de kopplade vyernas data (Tid, Frånvaro, Uppgifter, Order, Provision,
 * Kalendern, Ärenden, Fel, Rutiner, Utbildning). Här ligger bara det som inte
 * hör till någon av dem:
 *
 *   - valen i `nav_preference` (0094): när du senast tittade (`hem.sett`),
 *     sorterna du inte vill se i sammanfattningen (`hem.dolda`), raderna du
 *     sagt inte stämmer (`hem.flaggade`) och det gamla valet om Golvet (`hem.golvet`, styr inget);
 *   - Golvet just nu: lagets order och ordervärde i månaden mot lagets mål,
 *     dagens godkända order och Grattis (0120 `order_grattis`). LAGETS MÅL ÄR
 *     SUMMAN AV SÄLJARNAS MÅL I PROVISION (`sales_target`, 0049), beställaren
 *     2026-10-18. Ordermålet är det trappan och Provision ritar mot, så Golvet
 *     gör det också; kronmålet (provision i kronor) visas bara som tal.
 *   - kvällsnotisen i mobilen (0121): VAPID-nyckeln och hur många enheter du
 *     slagit på den för. Se `hem-kvall.ts` och `push.ts`.
 *
 * ===========================================================================
 * GOLVET LÄSER MED SERVICE ROLE, och det är det enda stället här som gör det.
 *
 * En säljare får bara läsa sina egna order (RLS). Golvet visar laget, så
 * summan och antalet räknas med service role, med repots egen `ordervarde()`
 * så att talet är samma som Orders nyckeltal räknat över laget.
 *
 * Kollegornas RADER (namn, kund, belopp) syns för alla i laget, som i
 * utkastet (beställaren 2026-10-19, beslutsrundan: "alla ser alla"). Före
 * beslutet såg en säljare bara sina egna rader och de kollegor som valt att
 * synas (`hem.golvet`); valet sparas fortfarande men styr inte längre något.
 * ===========================================================================
 */

export type NdGolvrad = {
  id: string;
  /** Förnamn och efternamnets initial. */
  vem: string;
  du: boolean;
  kund: string;
  vad: string;
  belopp: number | null;
  /** Klockslaget ordern godkändes, svensk tid. */
  kl: string;
  grattis: number;
  jag: boolean;
};

export type NdGolvet = {
  /** Lagets namn (flera lag: "Norr och Syd"), eller null för hela bolaget. */
  lag: string | null;
  manad: string;
  /** Summan av lagets mål i Provision: antal order och provision i kronor, null när ingen har ett. */
  mal: { order: number | null; kronor: number | null; utan: number };
  /** Lagets order netto i månaden (`nettoAntal`, samma tal som trappan räknar på). */
  antal: number;
  /** `ordervarde()` för laget: tecknat minus makulerat, utköp och finans. */
  netto: number;
  utanVarde: number;
  /** Dagens godkända order som läsaren får se, senaste först. */
  idag: NdGolvrad[];
  /** Dagens godkända order totalt, också de läsaren inte ser raden för. */
  idagAntal: number;
  idagSumma: number;
  /** Den senaste tidigare dagen med godkända order, för helgen ("Fredag: 3 godkända"). */
  senast: { dag: string; antal: number; summa: number } | null;
};

export type NdHem = {
  skriv: boolean;
  sett: string | null;
  dolda: string[];
  flaggade: string[];
  /** Det sparade valet `hem.golvet`. Det styr inte längre något: alla i laget ser lagets rader (se rubriken). */
  golvetSyns: boolean | null;
  /** Får läsaren sätta målen i Provision (säljchef och VD, 0049)? */
  malchef: boolean;
  /** Kvällsnotisen i mobilen (0121). Null när VAPID-nycklarna saknas i miljön. */
  push: { nyckel: string; enheter: number; ledare: boolean } | null;
  /** Null när läsaren inte har något lag (se `golvetUtanLag`) eller när talen inte gick att läsa (`lasfel.golvet`). */
  golvet: NdGolvet | null;
  /** Sant när Golvet saknas för att läsaren varken har eller leder ett lag: "Du är inte i något lag än." */
  golvetUtanLag: boolean;
  /** Alltid sant: alla har det nya hemmet. Fältet finns kvar för klienten, som ritar det gamla hemmet bara utan det. */
  nytt: true;
  /** Nav föreslår och Det som ändrats. Null när läsningen föll (`lasfel.forslag`). */
  forslag: NdForslag | null;
  /** Teamet i månaden. Null för den som bara har sig själv i sin krets, och när läsningen föll (`lasfel.team`). */
  team: NdTeam | null;
  /** Rutan Nya hemmet i Inställningar: värdena, för admin och uppåt. `farBrytare`: får slå på och av och ändra gränserna (superadmin). */
  inst: (ForslagInst & { farBrytare: boolean }) | null;
  /** Frågar skrivrutan Claude? Sant när chatten är påslagen och får vara det (`farSlasPa`). */
  chatt: boolean;
  /** Chattens läge och vad som saknas, för rutan i Inställningar. Bara superadmin. */
  chattLage: ChattLage | null;
  /** Hur stor del av månadens AI-utrymme personen har använt, i procent (0–100). Bara när skrivrutan frågar Claude. */
  chattAnvant: number | null;
  /** Min dag: arbetsdagens start, slut och rasternas minuter i dag ur schemat. Null utan schema. */
  dag: NdDag | null;
  /** Kort vars läsning föll. Bara de som föll står med, och då med true: tomt (rätt) skiljs från fel. */
  lasfel: NdHemFel;
};

/** Golvet, Teamet, Nav föreslår och Min dag: true när kortets läsning föll, i stället för att kortet försvinner tyst. */
/** `inst`: inställningarna föll. Då byggs inte Nav föreslår (det står som fel med Försök igen), och inget räknas med förval. */
export type NdHemFel = { golvet?: true; team?: true; forslag?: true; dag?: true; inst?: true };

/** Veckodag 1–7 med måndag först för ett kalenderdatum ("YYYY-MM-DD"). Datumet är redan räknat i rätt tidszon. */
const veckodagFor = (dag: string): number => {
  const [a, m, d] = dag.split("-").map(Number);
  return ((new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7) + 1;
};

/**
 * Dagens ram ur schemat och rasterna, med samma regel som Tid. Bara raderna som kan gälla läsaren läses: hens egna,
 * lagets och bolagets, som trätt i kraft. Ett fel kastas, så att hemmet kan säga att Min dag inte gick att läsa.
 */
async function lasDag(supabase: SupabaseClient, user: CurrentUser, tz: string, nu: Date = new Date()): Promise<NdDag | null> {
  const e = user.employee;
  if (!e) return null;
  const idag = lokalDag(nu, tz);
  const vd = veckodagFor(idag);
  const team = e.team_id ?? null;
  const vems = [`employee_id.eq.${e.id}`, ...(team ? [`team_id.eq.${team}`] : []), "scope.eq.company"].join(",");
  const [{ data: sr, error: se }, { data: rr, error: re }] = await Promise.all([
    supabase.from("work_schedule").select("scope, employee_id, team_id, weekday, start_time, end_time, valid_from").eq("weekday", vd).lte("valid_from", idag).or(vems),
    supabase.from("scheduled_break").select("scope, employee_id, team_id, weekday, sort, duration_minutes, valid_from").eq("weekday", vd).lte("valid_from", idag).or(vems),
  ]);
  if (se || re) throw new Error((se ?? re)?.message ?? "schemat");
  return dagensRam((sr ?? []) as SchemaRad[], (rr ?? []) as RastRad[], e.id, team, idag, vd);
}

/** Installationens tidszon (`moten.tidszon`), med förvalet ur Mötens inställningar när inget är sparat. */
export async function hemmetsTidszon(): Promise<string> {
  return (await lasInst(supabaseAdmin())).m.tidszon;
}

type Sida<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
type Person = { id: string; first_name: string | null; last_name: string | null; status: string | null };

/** Golvets krets: lagen (null = hela bolaget), deras namn och personerna i dem. */
export type GolvKrets = { lag: string[] | null; namn: string | null; folk: Person[] };

async function lasFolk(db: SupabaseClient, lag: readonly string[] | null): Promise<Person[]> {
  return lasSidvis<Person>((a, b) => {
    let q = db.from("employee").select("id, first_name, last_name, status");
    if (lag !== null) q = q.in("team_id", [...lag]);
    return q.order("id").range(a, b) as unknown as Sida<Person>;
  });
}

/**
 * Laget Golvet gäller: ens eget, annars alla lag man leder, annars hela bolaget, men bara för den som redan ser
 * hela bolaget i statistiken (säljchef, vd och admin, samma regel som `kretsFor`). Den som varken har eller leder
 * ett lag får inget Golvet (null), aldrig bolagets order. Samma regel prövar Grattis i rutten.
 */
export async function golvetsKrets(user: CurrentUser, leder?: () => Promise<LettLag[]>): Promise<GolvKrets | null> {
  if (!user.employee) return null;
  const db = supabaseAdmin();
  const eget = user.employee.team_id ?? null;
  if (eget) {
    const [{ data, error }, folk] = await Promise.all([db.from("team").select("name").eq("id", eget).maybeSingle(), lasFolk(db, [eget])]);
    if (error) throw new Error(error.message);
    return { lag: [eget], namn: (data?.name as string | undefined) ?? null, folk };
  }
  const lagen = await (leder ?? (() => lagenJagLeder(db, user.employee!.id)))();
  if (lagen.length) {
    const ids = lagen.map((t) => t.id);
    return { lag: ids, namn: textLagnamn(lagen.map((t) => t.namn)), folk: await lasFolk(db, ids) };
  }
  if (kretsFor(null, user.roles as string[]) !== null) return null;
  return { lag: null, namn: null, folk: await lasFolk(db, null) };
}

/**
 * Golvet just nu. Null för den som inte har något lag (se `golvetsKrets`). Ett läsfel kastas: en halv läsning
 * ser ut som en riktig nolla, och då är det bättre att kortet säger att talen inte gick att läsa.
 *
 * `o.tz` är installationens tidszon när den redan är läst, `o.leder` lagen läsaren leder (delas med Teamet).
 */
export async function byggGolvet(user: CurrentUser, nu: Date = new Date(), o: { tz?: string | Promise<string>; leder?: () => Promise<LettLag[]> } = {}): Promise<NdGolvet | null> {
  if (!user.employee) return null;
  const mig = user.employee.id;
  const db = supabaseAdmin();
  const [tz, k] = await Promise.all([o.tz ?? hemmetsTidszon(), golvetsKrets(user, o.leder)]);
  if (!k) return null;
  const idag = lokalDag(nu, tz);
  const manad = `${idag.slice(0, 7)}-01`;
  const vecka = new Date(nu.getTime() - 8 * 864e5).toISOString();
  const ingetMal = { order: null, kronor: null, utan: 0 };
  if (!k.folk.length) return { lag: k.namn, manad: manad.slice(0, 7), mal: ingetMal, antal: 0, netto: 0, utanVarde: 0, idag: [], idagAntal: 0, idagSumma: 0, senast: null };
  // Hela bolaget läses utan id-lista: hundratals uuid i en URL kan nekas av API-lagret.
  const ids = k.lag === null ? null : k.folk.map((p) => p.id);

  type Rad = { id: string; salesperson_id: string; package_id: number | null; term_months: number | null; status: string; order_value: number | string | null; approved_at: string | null; company_name: string | null };
  type MalRad = { employee_id: string; target_orders: number | null; target_amount: number | string | null };
  type Grattis = { order_id: string; employee_id: string };
  const KOL = "id, salesperson_id, package_id, term_months, signed_on, period_month, status, order_value, buyout_amount, finance_amount, cancel_period_month, approved_at, company_name";
  const [manadens, senaste, malen, paket, gratt] = await Promise.all([
    lasSidvis<Rad>((a, b) => {
      let q = db.from("sales_order").select(KOL).or(`period_month.eq.${manad},cancel_period_month.eq.${manad}`);
      if (ids) q = q.in("salesperson_id", ids);
      return q.order("id").range(a, b) as unknown as Sida<Rad>;
    }),
    lasSidvis<Rad>((a, b) => {
      let q = db.from("sales_order").select(KOL).in("status", ["signerad", "betald"]).gte("approved_at", vecka);
      if (ids) q = q.in("salesperson_id", ids);
      return q.order("id").range(a, b) as unknown as Sida<Rad>;
    }),
    lasSidvis<MalRad>((a, b) => {
      let q = db.from("sales_target").select("employee_id, target_orders, target_amount").eq("period_month", manad);
      if (ids) q = q.in("employee_id", ids);
      return q.order("id").range(a, b) as unknown as Sida<MalRad>;
    }),
    db.from("sales_package").select("id, label").limit(1000).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: number; label: string }[];
    }),
    // Grattis ges bara på en order som godkänts i dag, så två dygn bakåt räcker i varje tidszon.
    lasSidvis<Grattis>((a, b) =>
      db.from("order_grattis").select("order_id, employee_id").gte("created_at", new Date(nu.getTime() - 2 * 864e5).toISOString()).order("order_id").order("employee_id").range(a, b) as unknown as Sida<Grattis>,
    ),
  ]);
  const iLaget = new Set(k.folk.map((p) => p.id));

  // Lagets mål = summan av säljarnas mål för månaden. Bara summan lämnar servern (0049: säljaren ser inte andras mål).
  const mrader = malen.filter((m) => iLaget.has(m.employee_id));
  const oMal = mrader.filter((m) => m.target_orders !== null), kMal = mrader.filter((m) => m.target_amount !== null);
  const harOrder = new Set(manadens.map((o) => o.salesperson_id));
  const mal = {
    order: oMal.length ? oMal.reduce((s, m) => s + Number(m.target_orders), 0) : null,
    kronor: kMal.length ? kMal.reduce((s, m) => s + Number(m.target_amount), 0) : null,
    // Den som slutat räknas inte som "utan mål", men hens order står kvar i summan.
    utan: oMal.length ? k.folk.filter((p) => p.status !== "offboarded" && !oMal.some((m) => m.employee_id === p.id) && harOrder.has(p.id)).length : 0,
  };

  const varde = ordervarde(manadens as unknown as Order[], manad);
  const antal = nettoAntal(manadens as unknown as Order[], manad);

  const namn = new Map(k.folk.map((p) => [p.id, `${(p.first_name ?? "").trim()}${p.last_name ? ` ${p.last_name.trim().charAt(0)}.` : ""}`.trim()]));
  const paketNamn = new Map(paket.map((p) => [p.id, p.label]));
  const dag = (o: Rad) => lokalDag(o.approved_at as string, tz);
  const godkanda = senaste
    .filter((o) => o.approved_at && harGodkants(o.status as Order["status"]))
    .sort((a, b) => Date.parse(b.approved_at as string) - Date.parse(a.approved_at as string));
  // Alla i laget ser dagens rader (se rubriken).
  const dagens = godkanda.filter((o) => dag(o) === idag);
  const pidag = new Set(dagens.map((o) => o.id));
  const grattis = gratt.filter((g) => pidag.has(g.order_id));

  const summa = (l: Rad[]) => l.reduce((s, o) => s + (o.order_value === null ? 0 : Number(o.order_value)), 0);
  const tidigare = godkanda.filter((o) => dag(o) < idag);
  const senastDag = tidigare.length ? dag(tidigare[0]) : null;
  const senastRader = senastDag ? tidigare.filter((o) => dag(o) === senastDag) : [];
  const kl = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return {
    lag: k.namn,
    manad: manad.slice(0, 7),
    mal,
    antal,
    netto: varde.netto,
    utanVarde: varde.utanVarde,
    idag: dagens.map((o): NdGolvrad => {
      const p = o.package_id !== null ? paketNamn.get(o.package_id) : undefined;
      return {
        id: o.id,
        vem: namn.get(o.salesperson_id) ?? "",
        du: o.salesperson_id === mig,
        kund: o.company_name ?? "",
        vad: p ? `${p}${o.term_months ? `, ${o.term_months} mån` : ""}` : "Fri order",
        belopp: o.order_value === null ? null : Number(o.order_value),
        kl: kl.format(new Date(o.approved_at as string)),
        grattis: grattis.filter((g) => g.order_id === o.id).length,
        jag: grattis.some((g) => g.order_id === o.id && g.employee_id === mig),
      };
    }),
    idagAntal: dagens.length,
    idagSumma: summa(dagens),
    senast: senastDag ? { dag: senastDag, antal: senastRader.length, summa: summa(senastRader) } : null,
  };
}

/** Loggar ett kort som föll och svarar med null, så att resten av hemmet ritas. */
const loggaFel = (kort: string) => (e: unknown) => {
  console.error(`hem: ${kort} gick inte att läsa: ${e instanceof Error ? e.message : String(e)}`);
  return null;
};

export async function byggHem(supabase: SupabaseClient, user: CurrentUser): Promise<NdHem | null> {
  if (!user.employee) return null;
  const mig = user.employee.id;
  const nu = new Date();
  const db = supabaseAdmin();
  const niva = nivaFor(user.roles as string[]);
  // Lagen läsaren leder läses högst en gång, och bara om Golvet eller Teamet behöver dem.
  let lederP: Promise<LettLag[]> | null = null;
  const leder = () => (lederP ??= lagenJagLeder(db, mig));

  // Nya hemmet (0303): en läsning av inställningarna. Den ger också tidszonen, så Golvet väntar på den men inte tvärtom.
  // Ett läsfel blir `lasfel.inst` och `lasfel.forslag` nedan, i stället för förval som ser ut som att inget är inställt.
  let instFel = false;
  // Ett tillfälligt fel prövas en gång till, så att Nav föreslår inte faller för en enstaka miss. Faller båda blir det lasfel.inst.
  const instP = lasInst(db).catch(() => lasInst(db)).then((i) => i, (e: unknown) => { instFel = true; return loggaFel("inst")(e); });
  const tzP = instP.then((i) => i?.m.tidszon ?? INST_FORVAL.tidszon);
  // Golvet startar direkt och väntas in sist. Ett fel här fäller aldrig resten av hemmet.
  const golvetP = byggGolvet(user, nu, { tz: tzP, leder }).then((g) => ({ g, fel: false }), (e: unknown) => ({ g: loggaFel("golvet")(e), fel: true }));
  const kretsP = lasKrets(supabase, user).catch(() => undefined);
  // Frågebyggarna skickar först vid then: `.then((r) => r)` startar dem nu, samtidigt med resten.
  const valP = supabase.from("nav_preference").select("key, value").eq("employee_id", mig).in("key", ["hem.sett", "hem.dolda", "hem.flaggade", "hem.golvet"]).then((r) => r);
  const pushP = supabase.from("push_subscription").select("id", { count: "exact", head: true }).eq("employee_id", mig).then((r) => r);

  const inst = await instP;
  const tz = inst?.m.tidszon ?? INST_FORVAL.tidszon;
  // Chatten (0304). Superadmin får dessutom läget, som visas i Inställningar.
  const chattP = chattLage(db, mig, niva === "superadmin").catch(loggaFel("chatt"));
  const lasfel: NdHemFel = {};
  if (instFel) { lasfel.inst = true; lasfel.forslag = true; }
  let forslag: NdForslag | null = null;
  let team: NdTeam | null = null;
  let dag: NdDag | null = null;
  {
    const fall = <T>(kort: keyof NdHemFel, p: Promise<T>): Promise<T | null> => p.catch((e: unknown) => { lasfel[kort] = true; return loggaFel(kort)(e); });
    [forslag, team, dag] = await Promise.all([
      inst ? fall("forslag", byggForslag(supabase, user, inst, nu)) : Promise.resolve(null),
      fall("team", kretsP.then((krets) => {
        // Kretsen gick inte att läsa: för den som kan leda ett lag är det ett fel, för övriga finns inget kort att visa.
        if (krets === undefined && hasRole(user, "team_lead", "sales_manager", "ceo", "admin")) throw new Error("kretsen (mote_statkrets) gick inte att läsa");
        return byggTeam(user, krets, { tz, nu, leder });
      })),
      fall("dag", lasDag(supabase, user, tz, nu)),
    ]);
  }
  const [{ data: val }, { count: enheter }, chatt, golv] = await Promise.all([valP, pushP, chattP, golvetP]);
  if (golv.fel) lasfel.golvet = true;
  const golvet = golv.g;
  const chattPa = !!chatt && chatt.pa && chatt.skal === null;
  const nyckel = vapidPublik();
  const v = new Map(((val ?? []) as { key: string; value: unknown }[]).map((x) => [x.key, x.value]));
  const lista = (k: string): string[] => {
    const x = v.get(k);
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  };
  const sett = v.get("hem.sett");
  const syns = v.get("hem.golvet");
  return {
    skriv: SKRIVLAGE.hem,
    sett: typeof sett === "string" ? sett : null,
    dolda: lista("hem.dolda"),
    flaggade: lista("hem.flaggade"),
    golvetSyns: typeof syns === "boolean" ? syns : null,
    malchef: hasRole(user, "sales_manager", "ceo"),
    push: nyckel ? { nyckel, enheter: enheter ?? 0, ledare: hasRole(user, "sales_manager", "ceo", "team_lead") } : null,
    golvet,
    golvetUtanLag: !golv.fel && golvet === null,
    nytt: true,
    forslag,
    team,
    inst: inst && niva !== "salesperson" ? { ...inst.f, farBrytare: niva === "superadmin" } : null,
    chatt: chattPa,
    chattLage: niva === "superadmin" ? chatt : null,
    chattAnvant: chattPa && chatt?.utrymme ? Math.min(100, Math.round((chatt.utrymme.personUsd / chatt.utrymme.takPersonUsd) * 100)) : null,
    dag,
    lasfel,
  };
}
