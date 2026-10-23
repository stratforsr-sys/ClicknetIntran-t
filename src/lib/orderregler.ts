/**
 * Orderns formulärregler, gemensamma för /order (`order/actions.ts`) och
 * Nav 2.0 (`/nav2/order`). Ren logik, inga anrop.
 *
 * `tjansterUrFormular` och `angivenProvision` flyttades hit ordagrant ur
 * actions.ts i granskningen S08, så att Nav 2.0:s "Spara som utkast" prövar
 * tjänsterna och den angivna provisionen med samma regler (D16). En
 * `"use server"`-fil får bara exportera handlingar, så de kunde inte delas där.
 */
import { kronor, tolkaBelopp } from "./provision.ts";
import { giltigBindningstid, type Tjanst } from "./order.ts";

/**
 * Tillaggstjansterna, ur formularet.
 *
 * ===========================================================================
 * LISTAN KOMMER SOM JSON I ETT FALT, och det ar ett val.
 *
 * Antalet tjanster ar obestamt — det ar hela poangen med raderna — och
 * indexerade faltnamn (`tjanst_namn_0`, `tjanst_namn_1`) tvingar servern att
 * gissa var listan tar slut genom att rakna uppat tills ett falt saknas. En
 * bortglomd rad mitt i hade da tyst kapat resten.
 *
 * DEN HAR FUNKTIONEN AR ENDA STALLET JSON:EN TOLKAS, och den litar inte pa
 * nagot i den: talen ar pengar som gar rakt in i provisionsunderlaget genom
 * `affarensVarde`. Varje falt provas, och ett fel blir en mening till
 * anvandaren i stallet for en rad i databasen.
 * ===========================================================================
 */
export function tjansterUrFormular(form: FormData): { tjanster: Tjanst[] } | { fel: string } {
  const text = String(form.get("tjanster") ?? "").trim();
  if (!text) return { tjanster: [] };

  let ratt: unknown;
  try {
    ratt = JSON.parse(text);
  } catch {
    return { fel: "Tjänsterna på ordern gick inte att läsa. Ladda om sidan och försök igen." };
  }
  if (!Array.isArray(ratt)) {
    return { fel: "Tjänsterna på ordern gick inte att läsa. Ladda om sidan och försök igen." };
  }

  // Tjugo ar ingen asikt om hur manga tjanster en affar kan ha, utan en
  // yttre grans: en klient som skickar tusen rader ska motas av en mening och
  // inte av tusen inserts.
  if (ratt.length > 20) return { fel: "Högst tjugo tjänster per order." };

  const tjanster: Tjanst[] = [];

  for (const rad of ratt as Record<string, unknown>[]) {
    const namn = String(rad.name ?? "").trim();
    if (!namn) return { fel: "En tjänst saknar namn." };

    const fakturering = String(rad.billing ?? "");
    if (fakturering !== "engang" && fakturering !== "manad") {
      return { fel: `Välj engångsavgift eller månadsavgift för "${namn}".` };
    }

    const belopp =
      typeof rad.amount === "number" ? rad.amount : tolkaBelopp(String(rad.amount ?? ""));
    if (belopp === null || belopp <= 0) {
      return { fel: `Beloppet för "${namn}" gick inte att tolka.` };
    }

    // EN ENGANGSAVGIFT HAR ALDRIG EGEN BINDNINGSTID. Den kan inte loepa ut, och
    // `tjanst_engang_utan_bindning` i 0068 nekar raden — men beskedet ska komma
    // harifran som en mening, inte som ett villkorsnamn ur databasen.
    const egenBindning = fakturering === "manad" && rad.follows_order === false;

    let manader: number | null = null;
    let start: string | null = null;

    if (egenBindning) {
      manader = Number(rad.term_months);
      start = String(rad.starts_on ?? "");
      if (!giltigBindningstid(manader)) {
        return { fel: `Bindningstiden för "${namn}" ska vara 1–60 hela månader.` };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        return { fel: `Startdatumet för "${namn}" saknas.` };
      }
    }

    tjanster.push({
      name: namn,
      billing: fakturering,
      amount: belopp,
      follows_order: fakturering === "manad" && !egenBindning,
      term_months: manader,
      starts_on: start,
    });
  }

  return { tjanster };
}

// =============================================================================
// PROVISIONEN SOM SKREVS IN PA EN FRI ORDER SOM SKICKAS IN (0078).
//
// Beställaren 2026-10-09: en fri order pa chefen sjalv, 20 % i faltet, "Godkänn
// direkt" inte kryssat — och vid godkannandet blev det 40 %. `skapaOrder` raknade
// bara provisionen nar ordern godkandes i samma steg, sa talet i faltet kastades,
// och godkannandet tolkade det tomma som "rakna fram det".
//
// Nu sparas det som skrevs i `proposed_commission_*`, och godkannandet lagger
// tillbaka det i formularet nar formularet inte sjalvt bar nagon provision. Det
// ar samma tolkning som `raknaFramProvision` gor — talet gar alltsa genom
// precis samma kontroller som om det skrivits vid godkannandet.
// =============================================================================
export function angivenProvision(
  form: FormData,
): { belopp: number | null; procent: number | null } | { fel: string } {
  const formen = String(form.get("provision_form") ?? "").trim();
  if (formen === "procent") {
    const text = String(form.get("commission_percent") ?? "").trim();
    if (!text) return { belopp: null, procent: null };
    const procent = tolkaBelopp(text.replace(/%$/, ""));
    if (procent === null) return { fel: "Procentsatsen gick inte att tolka." };
    if (procent < 0 || procent > 100) return { fel: "Procentsatsen ska vara mellan 0 och 100." };
    return { belopp: null, procent };
  }
  // Utan valjaren raknas ingenting som handsatt — samma regel som i
  // `raknaFramProvision`.
  if (formen === "") return { belopp: null, procent: null };
  const text = String(form.get("commission_amount") ?? "").trim();
  if (!text) return { belopp: null, procent: null };
  const belopp = tolkaBelopp(text);
  if (belopp === null) return { fel: "Provisionsbeloppet gick inte att tolka." };
  if (belopp < 0) return { fel: "Provisionen kan inte vara negativ." };
  return { belopp, procent: null };
}

// =============================================================================
// RABATTERAT PAKETPRIS (granskningen S08, K5; beställarens beslut B2 2026-10-22)
//
// Kunden betalar mindre än listpris på en paketorder. Säljarens provision är
// matrisens, oförändrad. Ordervärdet, chefens egen försäljning, övertäcket och
// priset till Inkio räknas på det verkliga priset, och det priset fryses på
// ordern när den godkänns (`monthly_amount`, som för varje godkänd order).
//
// Före godkännandet står rabatten i `discounted_monthly_amount` (0221), inte i
// `monthly_amount`: ett månadsbelopp på en ogodkänd order betyder fri order
// för `raknaFramProvision`, `godkannOrder`, /orders Redigering och Nav 2.0.
// Kolumnen står kvar efter godkännandet, så att en rättelse behåller rabatten.
//
// Ett pris över listpris nekas: det är nästan alltid ett skrivfel, och en
// affär som inte följer paketet är en fri order.
// =============================================================================

/** Rabatten, om den ryms under listpriset; annars null (= listpris). */
export function giltigRabatt(listpris: number | null, pris: number | null | undefined): number | null {
  return listpris !== null && pris != null && pris > 0 && pris < listpris ? pris : null;
}

/** Månadspriset en paketorder räknas på: rabatten när den gäller, annars listpriset. */
export function paketManadsbelopp(listpris: number, rabatt: number | null | undefined): number {
  return giltigRabatt(listpris, rabatt) ?? listpris;
}

/**
 * Priset ur formuläret, för en paketorder.
 *
 * `null` när formuläret inte ritade priset (markören `pris_ritad` saknas, som
 * på /order): då gäller det ordern redan bar. Annars rabatten, eller `null`
 * för listpris. Ett pris som inte går att tolka eller ligger över listpris
 * blir ett besked.
 */
export function rabattUrFormular(
  form: FormData,
  listpris: number | null,
): { rabatt: number | null } | { fel: string } | null {
  if (!form.has("pris_ritad")) return null;
  const text = String(form.get("monthly_amount") ?? "").trim();
  if (!text) return { rabatt: null };
  const pris = tolkaBelopp(text);
  if (pris === null || pris <= 0) return { fel: "Priset per månad gick inte att tolka." };
  if (listpris === null) return { fel: "Paketet finns inte. Välj ett paket." };
  if (pris > listpris) {
    return {
      fel: `Priset kan inte vara högre än listpriset (${kronor(listpris)} i månaden). Lägg ordern utanför paketen om affären inte följer paketet.`,
    };
  }
  return { rabatt: giltigRabatt(listpris, pris) };
}

// "Rabatt 200 kr/mån: Kampanj." först i anteckningen, som utkastets ordSkapa skriver den.
const RABATTRAD = /^Rabatt \d[\d\s\u00a0]*(?:[.,]\d{1,2})? kr\/mån(?:: [^\n]*?)?\.\s*/;

/**
 * Anteckningen med rabatten först: `Rabatt <X> kr/mån: <skäl>.` (utkastets
 * text). En tidigare rabattrad byts, och utan rabatt tas den bort. En egen
 * mening om rabatt i annan form rörs inte.
 */
export function rabattAnteckning(note: string | null, listpris: number, rabatt: number | null, skal: string): string | null {
  const gammal = RABATTRAD.exec(note ?? "")?.[0] ?? "";
  const utan = (note ?? "").replace(RABATTRAD, "").trim();
  if (rabatt === null) return utan || null;
  // Utan nytt skäl står det gamla kvar: formuläret minns inte snabbvalet när ordern öppnas igen.
  const s = (skal.trim() || (/^Rabatt [^:]*: (.*)\.\s*$/.exec(gammal)?.[1] ?? "")).replace(/\.$/, "").slice(0, 200);
  const rad = `Rabatt ${Math.round((listpris - rabatt) * 100) / 100} kr/mån${s ? `: ${s}` : ""}.`;
  return utan ? `${rad} ${utan}` : rad;
}

// =============================================================================
// GODKÄNNANDET EN GÅNG (granskningen S08, D6)
//
// `godkannOrder` uppdaterar med villkoret på den status som lästes och läser
// tillbaka raden. Två tryck på Godkänn läser båda `inskickad`; den andra
// uppdateringen träffar ingen rad, och då bokförs varken övertäck eller
// eftersläpning en gång till.
// =============================================================================
// =============================================================================
// ÅNGRA "FÖRLÄNGER INTE" (granskningen S08, D23)
//
// Utkastet har Ångra i kvittot efter "Förlänger inte". Att ta tillbaka ett
// utfall är annars bara för säljchef, VD och ekonomi (`aterupptaBevakning`),
// men den som just bokförde det på sin egen order får ångra sitt eget besked
// i tio minuter, som Ångra på andra ställen i Nav 2.0.
// =============================================================================
export const ANGRA_UTFALL_MS = 10 * 60 * 1000;
export function farAngraUtfall(
  o: { renewal_outcome: string | null; renewal_by: string | null; renewal_at: string | null; salesperson_id: string },
  mig: string,
  nu: number = Date.now(),
): boolean {
  if (o.renewal_outcome !== "avslutad" || o.renewal_by !== mig || o.salesperson_id !== mig || !o.renewal_at) return false;
  const nar = Date.parse(o.renewal_at);
  return Number.isFinite(nar) && nu - nar >= 0 && nu - nar <= ANGRA_UTFALL_MS;
}

export function godkannandeSkrevs(skrivet: { id: string }[] | null | undefined): boolean {
  return Array.isArray(skrivet) && skrivet.length > 0;
}
