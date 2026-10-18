import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { harGodkants, nettoAntal, ordervarde, type Order } from "@/lib/order";
import { SKRIVLAGE } from "./skrivlage";
import { vapidPublik } from "./push";

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
 *     sagt inte stämmer (`hem.flaggade`) och om du syns på Golvet (`hem.golvet`);
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
 * Kollegornas RADER (namn, kund, belopp) är något annat än en summa. Utkastets
 * egen förklaring säger att Golvet bör vara frivilligt per säljare innan det
 * slås på. En säljare ser därför sina egna rader och de kollegor som sagt ja
 * (`hem.golvet` = true). Den som får läsa allas order i navet (säljchef, VD,
 * ekonomi: `far_hantera_provision`) ser alla rader, som på /order.
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
  /** Lagets namn, eller null för hela bolaget. */
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
  /** Syns du på Golvet för kollegorna? Null = inte valt (då syns du inte). */
  golvetSyns: boolean | null;
  /** Får läsaren sätta målen i Provision (säljchef och VD, 0049)? */
  malchef: boolean;
  /** Kvällsnotisen i mobilen (0121). Null när VAPID-nycklarna saknas i miljön. */
  push: { nyckel: string; enheter: number; ledare: boolean } | null;
  golvet: NdGolvet | null;
};

const KL = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Laget Golvet gäller: ens eget, annars det man leder, annars hela bolaget. */
export async function golvetsLag(user: CurrentUser): Promise<{ id: string | null; namn: string | null }> {
  const db = supabaseAdmin();
  const eget = user.employee?.team_id ?? null;
  if (eget) {
    const { data } = await db.from("team").select("id, name").eq("id", eget).maybeSingle();
    return { id: eget, namn: (data?.name as string | undefined) ?? null };
  }
  const { data: leder } = await db.from("team").select("id, name").eq("lead_id", user.employee!.id).order("name").limit(1);
  const t = (leder ?? [])[0] as { id: string; name: string } | undefined;
  return t ? { id: t.id, namn: t.name } : { id: null, namn: null };
}

export async function byggGolvet(user: CurrentUser, nu: Date = new Date()): Promise<NdGolvet | null> {
  if (!user.employee) return null;
  const mig = user.employee.id;
  const db = supabaseAdmin();
  const idag = svensktDatum(nu);
  const manad = `${idag.slice(0, 7)}-01`;
  const vecka = new Date(nu.getTime() - 8 * 864e5).toISOString();
  const lag = await golvetsLag(user);

  let personFraga = db.from("employee").select("id, first_name, last_name");
  if (lag.id) personFraga = personFraga.eq("team_id", lag.id);
  const [{ data: personer }, { data: paket }] = await Promise.all([personFraga, db.from("sales_package").select("id, label")]);
  const folk = (personer ?? []) as { id: string; first_name: string | null; last_name: string | null }[];
  const ids = folk.map((p) => p.id);
  const ingetMal = { order: null, kronor: null, utan: 0 };
  if (!ids.length) return { lag: lag.namn, manad: manad.slice(0, 7), mal: ingetMal, antal: 0, netto: 0, utanVarde: 0, idag: [], idagAntal: 0, idagSumma: 0, senast: null };

  const KOL = "id, salesperson_id, package_id, term_months, signed_on, period_month, status, order_value, buyout_amount, finance_amount, cancel_period_month, approved_at, company_name";
  const [{ data: manadens }, { data: senaste }, { data: syns }, { data: malen }] = await Promise.all([
    db.from("sales_order").select(KOL).in("salesperson_id", ids).or(`period_month.eq.${manad},cancel_period_month.eq.${manad}`),
    db.from("sales_order").select(KOL).in("salesperson_id", ids).in("status", ["signerad", "betald"]).gte("approved_at", vecka).order("approved_at", { ascending: false }),
    db.from("nav_preference").select("employee_id, value").eq("key", "hem.golvet").in("employee_id", ids),
    db.from("sales_target").select("employee_id, target_orders, target_amount").eq("period_month", manad).in("employee_id", ids),
  ]);
  // Lagets mål = summan av säljarnas mål för månaden. Bara summan lämnar servern (0049: säljaren ser inte andras mål).
  const mrader = (malen ?? []) as { employee_id: string; target_orders: number | null; target_amount: number | string | null }[];
  const oMal = mrader.filter((m) => m.target_orders !== null), kMal = mrader.filter((m) => m.target_amount !== null);
  const mal = {
    order: oMal.length ? oMal.reduce((s, m) => s + Number(m.target_orders), 0) : null,
    kronor: kMal.length ? kMal.reduce((s, m) => s + Number(m.target_amount), 0) : null,
    utan: oMal.length ? folk.filter((p) => !oMal.some((m) => m.employee_id === p.id) && ((manadens ?? []) as { salesperson_id: string }[]).some((o) => o.salesperson_id === p.id)).length : 0,
  };

  const varde = ordervarde((manadens ?? []) as unknown as Order[], manad);
  const antal = nettoAntal((manadens ?? []) as unknown as Order[], manad);

  // Radernas krets, se rubriken.
  const allaRader = hasRole(user, "sales_manager", "ceo", "finance");
  const sagtJa = new Set(((syns ?? []) as { employee_id: string; value: unknown }[]).filter((x) => x.value === true).map((x) => x.employee_id));
  const namn = new Map(folk.map((p) => [p.id, `${(p.first_name ?? "").trim()}${p.last_name ? ` ${p.last_name.trim().charAt(0)}.` : ""}`.trim()]));
  const paketNamn = new Map(((paket ?? []) as { id: number; label: string }[]).map((p) => [p.id, p.label]));

  type Rad = { id: string; salesperson_id: string; package_id: number | null; term_months: number | null; status: string; order_value: number | string | null; approved_at: string | null; company_name: string | null };
  const godkanda = ((senaste ?? []) as unknown as Rad[]).filter((o) => o.approved_at && harGodkants(o.status as Order["status"]));
  const dagens = godkanda.filter((o) => svensktDatum(new Date(o.approved_at as string)) === idag);
  const synliga = dagens.filter((o) => allaRader || o.salesperson_id === mig || sagtJa.has(o.salesperson_id));

  const { data: gratt } = synliga.length
    ? await db.from("order_grattis").select("order_id, employee_id").in("order_id", synliga.map((o) => o.id))
    : { data: [] as { order_id: string; employee_id: string }[] };
  const grattis = (gratt ?? []) as { order_id: string; employee_id: string }[];

  const summa = (l: Rad[]) => l.reduce((s, o) => s + (o.order_value === null ? 0 : Number(o.order_value)), 0);
  const tidigare = godkanda.filter((o) => svensktDatum(new Date(o.approved_at as string)) < idag);
  const senastDag = tidigare.length ? svensktDatum(new Date(tidigare[0].approved_at as string)) : null;
  const senastRader = senastDag ? tidigare.filter((o) => svensktDatum(new Date(o.approved_at as string)) === senastDag) : [];

  return {
    lag: lag.namn,
    manad: manad.slice(0, 7),
    mal,
    antal,
    netto: varde.netto,
    utanVarde: varde.utanVarde,
    idag: synliga.map((o): NdGolvrad => {
      const p = o.package_id !== null ? paketNamn.get(o.package_id) : undefined;
      return {
        id: o.id,
        vem: namn.get(o.salesperson_id) ?? "",
        du: o.salesperson_id === mig,
        kund: o.company_name ?? "",
        vad: p ? `${p}${o.term_months ? `, ${o.term_months} mån` : ""}` : "Fri order",
        belopp: o.order_value === null ? null : Number(o.order_value),
        kl: KL.format(new Date(o.approved_at as string)),
        grattis: grattis.filter((g) => g.order_id === o.id).length,
        jag: grattis.some((g) => g.order_id === o.id && g.employee_id === mig),
      };
    }),
    idagAntal: dagens.length,
    idagSumma: summa(dagens),
    senast: senastDag ? { dag: senastDag, antal: senastRader.length, summa: summa(senastRader) } : null,
  };
}

export async function byggHem(supabase: SupabaseClient, user: CurrentUser): Promise<NdHem | null> {
  if (!user.employee) return null;
  const mig = user.employee.id;
  const [{ data: val }, golvet, { count: enheter }] = await Promise.all([
    supabase.from("nav_preference").select("key, value").eq("employee_id", mig).in("key", ["hem.sett", "hem.dolda", "hem.flaggade", "hem.golvet"]),
    byggGolvet(user),
    supabase.from("push_subscription").select("id", { count: "exact", head: true }).eq("employee_id", mig),
  ]);
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
  };
}
