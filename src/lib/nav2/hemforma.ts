/**
 * Nav 2.0: hemvyns tal, den rena delen.
 *
 * Teamet i månaden visar nettoorder mot målet, och det stora talet är det
 * säkra: samma `nettoAntal` som provisionens trappa räknar på. Väntande order
 * står som antal och räknas aldrig in. Här finns inga egna uträkningar av order:
 * allt går genom `order.ts`, så att kortet aldrig kan säga något annat än
 * Provision gör.
 *
 * Ren logik, inga läsningar. Servern (`hem.ts`) hämtar raderna och prov körs på
 * exakt de här funktionerna.
 */
import { harGodkants, makuleradeIPeriod, nettoAntal, type Order } from "../order.ts";
import { lokalDag, skaBekraftas } from "./motesflode.ts";
import type { StatMote } from "./motesstatforma.ts";

/** Det hemvyn läser av en order. `signed_on` och `cancelled_on` är dagar ("YYYY-MM-DD"). */
export type TeamOrder = {
  id: string;
  salesperson_id: string;
  status: string;
  signed_on: string;
  period_month: string | null;
  cancelled_on: string | null;
  cancel_period_month: string | null;
};

export type TeamTal = {
  /** Signerade i månaden minus makulerade i månaden. Kan bli negativt. */
  netto: number;
  /** Inskickade order som väntar på godkännande. Ett antal, aldrig inräknat i netto. */
  vantar: number;
  makulerade: number;
  /** Summan av kretsens mål i antal order. null när ingen i kretsen har ett mål. */
  mal: number | null;
  /** Personer i kretsen som har order i månaden men inget mål. 0 när ingen har ett mål alls. */
  utanMal: number;
};

const iKrets = (krets: readonly string[] | null) => {
  const s = krets === null ? null : new Set(krets);
  return (id: string): boolean => s === null || s.has(id);
};
const somOrder = (o: readonly TeamOrder[]): Order[] => o as unknown as Order[];

/** `manad` är "YYYY-MM". `krets` null = hela företaget. */
export function teamTal(
  order: readonly TeamOrder[],
  mal: readonly { employee_id: string; target_orders: number | null }[],
  krets: readonly string[] | null,
  manad: string,
): TeamTal {
  const med = iKrets(krets);
  const p = `${manad}-01`;
  const egna = order.filter((o) => med(o.salesperson_id));
  const vantande = egna.filter((o) => o.status === "inskickad" && o.period_month === p);
  const malen = mal.filter((m) => med(m.employee_id) && m.target_orders !== null);
  const harMal = new Set(malen.map((m) => m.employee_id));
  // Den som har en order i månaden (godkänd eller väntande) men inget mål gör att summan inte är hela lagets mål.
  const medOrder = new Set([...egna.filter((o) => harGodkants(o.status as Order["status"]) && o.period_month === p), ...vantande].map((o) => o.salesperson_id));
  return {
    netto: nettoAntal(somOrder(egna), p),
    vantar: vantande.length,
    makulerade: makuleradeIPeriod(somOrder(egna), p).length,
    mal: malen.length ? malen.reduce((s, m) => s + Number(m.target_orders), 0) : null,
    utanMal: malen.length ? [...medOrder].filter((id) => !harMal.has(id)).length : 0,
  };
}

/**
 * Nettoorder per dag och månad: plus ett den dag ordern signerades, minus ett
 * den dag den makulerades. Det är underlaget när taktens facit räknas i
 * efterhand för månader innan Nav började spara vad takten sa.
 */
export function dagstalPerManad(order: readonly TeamOrder[], krets: readonly string[] | null): Record<string, Record<string, number>> {
  const med = iKrets(krets);
  const ut: Record<string, Record<string, number>> = {};
  const lagg = (dag: string, n: number) => {
    const m = (ut[dag.slice(0, 7)] ??= {});
    m[dag] = (m[dag] ?? 0) + n;
  };
  for (const o of order) {
    if (!med(o.salesperson_id) || !harGodkants(o.status as Order["status"])) continue;
    lagg(o.signed_on, 1);
    if (o.status === "makulerad" && o.cancelled_on) lagg(o.cancelled_on, -1);
  }
  return ut;
}

/** Månadens slutliga nettoorder, för varje månad i listan ("YYYY-MM"). */
export function blevPerManad(order: readonly TeamOrder[], krets: readonly string[] | null, manader: readonly string[]): Record<string, number> {
  const med = iKrets(krets);
  const egna = somOrder(order.filter((o) => med(o.salesperson_id)));
  return Object.fromEntries(manader.map((m) => [m, nettoAntal(egna, `${m}-01`)]));
}

export type TeamPerson = { id: string; namn: string; bokade: number; hallna: number; uteblivna: number; order: number };

/**
 * Genomgången: en rad per person i bokstavsordning med det som finns. Antal,
 * utan färg och utan dom. Bokade är första möten personen bokade i månaden;
 * hållna och uteblivna är första möten personen höll i månaden.
 */
export function teamPersoner(
  personer: readonly { id: string; namn: string }[],
  moten: readonly StatMote[],
  order: readonly TeamOrder[],
  manad: string,
  tz: string,
): TeamPerson[] {
  const iManad = (ts: string) => lokalDag(ts, tz).slice(0, 7) === manad;
  const forsta = moten.filter((m) => skaBekraftas(m.art));
  return personer
    .map((p) => ({
      id: p.id,
      namn: p.namn,
      bokade: forsta.filter((m) => m.bokatAv === p.id && iManad(m.bokatNar)).length,
      hallna: forsta.filter((m) => m.hallsAv === p.id && m.utfall === "hallet" && iManad(m.moteTid)).length,
      uteblivna: forsta.filter((m) => m.hallsAv === p.id && m.utfall === "uteblev" && iManad(m.moteTid)).length,
      order: nettoAntal(somOrder(order.filter((o) => o.salesperson_id === p.id)), `${manad}-01`),
    }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
}

/**
 * Nyckeln i `nav_takt_dag` för läsarens krets: "alla" för den som ser hela
 * företaget, lagets id för en teamledare. null när det inte finns någon sparad
 * takt att läsa (då räknas facit i efterhand).
 */
export function taktKrets(krets: readonly string[] | null, lagId: string | null): string | null {
  return krets === null ? "alla" : lagId;
}
