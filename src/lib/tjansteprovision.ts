/**
 * Provisionen på en orders tilläggstjänster (0293).
 *
 * Ren logik — inga anrop, ingen import av Supabase. Samma linje som `utkop.ts`
 * och `finans.ts`: filen ska gå att prova utan att starta Next. Se
 * `tests/tjansteprovision.mjs`.
 *
 * ===========================================================================
 * BESTÄLLAREN 2026-11-13:
 *
 *   *"när vi lägger till en till tjänst i order så måste vi sätta provision på
 *   det också. Låt en chef, admin eller superadmin kunna gå in och sätta
 *   provision när det finns extra tjänster … antingen procent eller fast."*
 *
 * Och på följdfrågan samma dag: godkännandet KRÄVER ett val per tjänst. 0 kr
 * är ett giltigt val, men det ska vara ett val och inte en glömska. Före det
 * här gav en tjänst ingen provision alls på en paketorder (Jämtlandsstäd #40:
 * matrisens 3 500 kr för paketet, ingenting för hemsidan eller SEO:n), medan
 * övertäcket räknades på hela värdet.
 * ===========================================================================
 *
 * TJÄNSTEPROVISIONEN GÄLLER BARA OVANPÅ MATRISEN. Matrisens fasta belopp
 * betalar paketet och ingenting annat. Alla andra grunder räknar redan på ett
 * värde där tjänsterna ingår: 12 % av det som blir kvar efter utköp och finans,
 * chefens egen sats på nettot, och en handsatt provision på hela affären. En
 * tjänsteprovision ovanpå någon av dem hade betalat samma krona två gånger.
 * Valet ligger i `saljarensProvision`, inte här.
 *
 * INGEN SATS STÅR I DEN HÄR FILEN. Procenten och beloppet är vad hanteraren
 * skrev på just den tjänsten, och de står på raden i `sales_order_service`.
 */

import { avrunda } from "./provision-motor.ts";
import { tolkaBelopp } from "./provision.ts";
import { tjanstensVarde, type Tjanst } from "./order.ts";

/** Hur provisionen på en tjänst skrevs. Speglar `commission_form` i 0293. */
export const TJANSTPROVISION_FORM = ["belopp", "procent"] as const;
export type Tjanstprovisionsform = (typeof TJANSTPROVISION_FORM)[number];

/**
 * Valet på en tjänst: fast belopp i kronor eller procent av tjänstens värde.
 *
 * `null` på tjänsten betyder att ingen har valt än — aldrig "noll kronor".
 * Noll är ett val och skrivs `{ form: "belopp", varde: 0 }`. Skillnaden är
 * hela spärren: en tjänst utan val stoppar godkännandet, en nolla gör det inte.
 */
export type Tjanstprovision = { form: Tjanstprovisionsform; varde: number };

/**
 * Tjänstens provision i kronor, eller null när inget val är gjort.
 *
 * PROCENTEN RÄKNAS PÅ TJÄNSTENS VÄRDE, inte på hela ordern: en engångsavgift
 * på sitt belopp, en månadstjänst på beloppet gånger sin löptid — exakt det
 * tal tjänsten bidrar med i ordervärdet (`tjanstensVarde`). 10 % på SEO 1 995
 * kr/mån i tolv månader är alltså 2 394 kr, inte 200 kr.
 *
 * Avrundas till hela kronor här, en gång per tjänst. Beloppet fryses på raden
 * och går aldrig genom någon andra avrundning — samma regel som
 * `utkopsprovision`.
 */
export function tjanstensProvision(tjanst: Tjanst, orderLoptid: number): number | null {
  const p = tjanst.provision;
  if (!p) return null;
  if (p.form === "belopp") return avrunda(p.varde);
  return avrunda((tjanstensVarde(tjanst, orderLoptid) * p.varde) / 100);
}

/** Namnen på tjänsterna som saknar ett val, i orderns ordning. */
export function utanProvision(tjanster: Tjanst[]): string[] {
  return tjanster.filter((t) => !t.provision).map((t) => t.name);
}

/** "Hemsida", "Hemsida och SEO", "Hemsida, SEO och Annonsering". */
export function uppraknat(namn: string[]): string {
  if (namn.length <= 1) return namn.join("");
  return `${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
}

/** Beskedet när godkännandet stoppas. Samma mening på servern och i Nav 2.0. */
export function saknasText(namn: string[]): string {
  return namn.length === 1
    ? `Sätt provision på tjänsten ${namn[0]} först. Välj kronor eller procent, 0 kr går också.`
    : `Sätt provision på tjänsterna ${uppraknat(namn)} först. Välj kronor eller procent per tjänst, 0 kr går också.`;
}

/** "10 %" eller "800 kr" — så som valet skrevs. */
export function valtext(p: Tjanstprovision): string {
  const tal = (Math.round(p.varde * 100) / 100).toLocaleString("sv-SE");
  return p.form === "procent" ? `${tal} %` : `${tal} kr`;
}

/**
 * Valet ur en rad i formulärets `tjanster`-JSON, eller null när inget är valt.
 *
 * Fälten heter `provision_form` (`belopp` | `procent`) och `provision` (talet,
 * som text eller tal). Ett tomt tal är inget val. Ett tal som inte går att
 * tolka, är negativt eller är en procent över 100 blir en mening till
 * användaren — samma gränser som `angivenProvision` drar för hela ordern.
 */
export function provisionUrRad(
  rad: Record<string, unknown>,
  namn: string,
): Tjanstprovision | null | { fel: string } {
  const form = String(rad.provision_form ?? "").trim();
  const text = rad.provision === null || rad.provision === undefined ? "" : String(rad.provision).trim();
  if (!form || text === "") return null;
  if (form !== "belopp" && form !== "procent") {
    return { fel: `Välj kronor eller procent för provisionen på "${namn}".` };
  }
  const varde = typeof rad.provision === "number" ? rad.provision : tolkaBelopp(text.replace(/%$/, ""));
  if (varde === null || !Number.isFinite(varde)) {
    return { fel: `Provisionen på "${namn}" gick inte att tolka.` };
  }
  if (varde < 0) return { fel: `Provisionen på "${namn}" kan inte vara negativ.` };
  if (form === "procent" && varde > 100) {
    return { fel: `Procenten på "${namn}" ska vara mellan 0 och 100.` };
  }
  return { form, varde };
}

/**
 * En tjänsts identitet när listan skrivs om: namn, typ och belopp.
 *
 * Säljaren rättar ofta något annat på en inskickad order (en anteckning, ett
 * telefonnummer), och tjänsterna skrivs då om från formuläret. Säljaren får
 * inte sätta provision, så formuläret bär inga val — utan nyckeln hade varje
 * sådan rättelse tyst suddat det säljchefen redan satt. Ändras tjänsten själv
 * (ett annat belopp) är valet inte längre säkert, och då får hanteraren göra
 * om det.
 */
function nyckel(t: Pick<Tjanst, "name" | "billing" | "amount">): string {
  return `${t.name.trim().toLowerCase()}|${t.billing}|${Number(t.amount)}`;
}

/**
 * Vilken gammal rad varje ny rad är, eller -1.
 *
 * ===========================================================================
 * PLATSEN FÖRST, NYCKELN BARA NÄR DEN ÄR ENTYDIG (granskningen 2026-11-13, I1).
 *
 * Två tjänster med samma namn, typ och belopp på samma order ("Extra sida, 2 000
 * kr engång" två gånger) har samma nyckel. En karta på nyckeln hade gett båda
 * det sista valet, så 1 000 kr på den ena och tomt på den andra hade frusit
 * 1 000 kr på båda — utan fel. Därför:
 *
 *   SAMMA LISTA I SAMMA ORDNING  rad för rad, på platsen. Det är fallet för
 *                                kortets ruta och för Rätta, som båda ritar
 *                                tjänsterna i orderns ordning.
 *   ANNARS                       på nyckeln, men bara en nyckel som finns EN gång
 *                                i båda listorna. En tvetydig rad får inget val —
 *                                då stoppar spärren godkännandet och hanteraren
 *                                väljer, i stället för att ett tal hamnar fel.
 * ===========================================================================
 */
export function paraIhop(nya: Tjanst[], gamla: Tjanst[]): number[] {
  if (nya.length === gamla.length && nya.every((t, i) => nyckel(t) === nyckel(gamla[i]))) {
    return nya.map((_, i) => i);
  }
  const antal = (l: Tjanst[]) => {
    const m = new Map<string, number>();
    for (const t of l) m.set(nyckel(t), (m.get(nyckel(t)) ?? 0) + 1);
    return m;
  };
  const iNya = antal(nya);
  const iGamla = antal(gamla);
  return nya.map((t) => {
    const k = nyckel(t);
    return iNya.get(k) === 1 && iGamla.get(k) === 1 ? gamla.findIndex((g) => nyckel(g) === k) : -1;
  });
}

/** Nya tjänster med de val de gamla hade, rad för rad (`paraIhop`). Ett val i det nya går före. */
export function behallProvision(nya: Tjanst[], gamla: Tjanst[]): Tjanst[] {
  const par = paraIhop(nya, gamla);
  // Alltid null och aldrig undefined för "inget val", som `provisionUrRad` ger.
  return nya.map((t, i) => ({ ...t, provision: t.provision ?? (par[i] < 0 ? null : (gamla[par[i]].provision ?? null)) }));
}

/**
 * Nya tjänster med de gamlas EGNA bindningstid, när Nav 2.0 skrivit om listan.
 *
 * Nav 2.0:s formulär kan inte rita en månadstjänst med egen bindningstid och
 * skickar varje månadstjänst som "följer ordern". Utan den här raden hade en
 * rättelse av något annat på en inskickad order gjort en sexmånaderstjänst till
 * en på orderns tjugofyra (granskningen M5). En rad som själv säger att den har
 * egen bindning (gamla Nav) står kvar som den är.
 */
export function behallBindning(nya: Tjanst[], gamla: Tjanst[]): Tjanst[] {
  const par = paraIhop(nya, gamla);
  return nya.map((t, i) => {
    const g = par[i] < 0 ? null : gamla[par[i]];
    if (!g || g.billing !== "manad" || g.follows_order || t.billing !== "manad" || !t.follows_order) return t;
    return { ...t, follows_order: false, term_months: g.term_months, starts_on: g.starts_on };
  });
}

/**
 * Formulärets val ovanpå databasens tjänster (rättelsen av en GODKÄND order).
 *
 * `redigeraOrder` räknar på tjänsterna i databasen — formuläret får inte lägga
 * till eller ta bort tjänster på en godkänd order. Bara valet följer med, rad
 * för rad enligt `paraIhop`. En rad i formuläret UTAN val tar inte bort ett val
 * som finns; den säger bara ingenting.
 */
export function valUrFormular(databasen: Tjanst[], formularet: Tjanst[]): Tjanst[] {
  const par = paraIhop(databasen, formularet);
  return databasen.map((t, i) => {
    const v = par[i] < 0 ? null : formularet[par[i]].provision;
    return v ? { ...t, provision: v } : t;
  });
}

/** Raden till `sales_order_service`, i orderns ordning. Samma form i alla tre skrivvägar. */
export function tjanstRad(orderId: string, t: Tjanst, sort: number): Record<string, unknown> {
  return {
    order_id: orderId,
    name: t.name,
    billing: t.billing,
    amount: t.amount,
    follows_order: t.follows_order,
    term_months: t.term_months,
    starts_on: t.starts_on,
    sort,
    commission_form: t.provision?.form ?? null,
    commission_value: t.provision?.varde ?? null,
    // Kronorna fryses först vid godkännandet; före det står de tomma.
    commission_amount: t.provision_kr ?? null,
  };
}
