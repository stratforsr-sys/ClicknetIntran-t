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

// "Rabatt 200 kr/mån: Kampanj." i anteckningen, som utkastets ordSkapa skriver den. Raden
// hittas var den än står (S10b: en rad som inte stod först dubblerades) och slutar vid en
// punkt följd av mellanrum eller slutet, så att ett skäl som "Kampanj v.42" behålls helt.
const RABATTRAD = /(^|\s)Rabatt \d[\d\s\u00a0]*(?:[.,]\d{1,2})? kr\/mån(?:: [^\n]*?)?\.(?=\s|$)/;

/**
 * Anteckningen med rabatten först: `Rabatt <X> kr/mån: <skäl>.` (utkastets
 * text). En tidigare rabattrad byts, och utan rabatt tas den bort. En egen
 * mening om rabatt i annan form rörs inte.
 */
export function rabattAnteckning(note: string | null, listpris: number, rabatt: number | null, skal: string): string | null {
  const gammal = (RABATTRAD.exec(note ?? "")?.[0] ?? "").trim();
  // Raden och mellanrummet efter den tas bort; resten av anteckningen rörs inte.
  const utan = (note ?? "").replace(new RegExp(RABATTRAD.source + "[ \\t]*"), "$1").trim();
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

// =============================================================================
// RÄTTELSE AV EN GODKÄND ORDER (granskningen S10b, D10)
//
// En godkänd paketorder bär sitt frysta pris i `monthly_amount` (listpriset den
// dag den godkändes, eller rabatten). Rättelsen räknade förut om priset mot
// DAGENS listpris: sänktes listpriset nekades rättelsen ("högre än listpriset"),
// och höjdes det blev det frysta priset en rabatt i tysthet. Nu gäller det
// frysta priset så länge paketet är detsamma och priset står kvar (eller inte
// skickades, som från /order). Ett ändrat pris eller ett annat paket är ett nytt
// beslut och prövas mot dagens listpris, som när en order läggs.
// =============================================================================
export function rattelsePris(
  form: FormData,
  o: { listpris: number | null; sammaPaket: boolean; fryst: number | null; frystRabatt: number | null },
): { fryst: number | null; rabatt: number | null } | { fel: string } {
  const frystGaller = o.sammaPaket && o.fryst !== null && o.fryst > 0;
  // Rabatten följer med bara när den är det frysta priset; en inaktuell kolumn skrivs inte tillbaka.
  const behall = () => ({ fryst: o.fryst, rabatt: o.frystRabatt !== null && o.frystRabatt === o.fryst ? o.fryst : null });
  if (!form.has("pris_ritad")) return frystGaller ? behall() : { fryst: null, rabatt: giltigRabatt(o.listpris, o.frystRabatt) };
  const text = String(form.get("monthly_amount") ?? "").trim();
  // Ett tomt fält betyder orört, som i resten av rättelsen.
  if (frystGaller && (!text || tolkaBelopp(text) === o.fryst)) return behall();
  const val = rabattUrFormular(form, o.listpris);
  if (val && "fel" in val) return val;
  return { fryst: null, rabatt: val?.rabatt ?? null };
}

/**
 * Formuläret en rättelse räknar provisionen på (S10b, D10).
 *
 * Nav 2.0:s formulär har inget provisionsfält för en paketorder. En paketorder
 * vars provision sattes för hand (`commission_source = 'manual'`) räknades
 * därför om på matrisen vid varje rättelse. Väljer formuläret ingen provision
 * själv läggs orderns frysta belopp tillbaka, som `medAngivenProvision` gör vid
 * godkännandet; bär formuläret ett eget val gäller det.
 *
 * Omvänt för en fri order vars provision INTE sattes för hand (chefens egen
 * försäljning, utköpet): formuläret är förifyllt med den frysta provisionen,
 * och ett oförändrat tal där är förifyllningen, inget beslut. Det tas bort, så
 * att regeln räknar om (40 % av det nya värdet), i stället för att det frysta
 * beloppet blir handsatt i tysthet. Ett ändrat tal är ett beslut och gäller.
 */
export function rattelseProvision(
  form: FormData,
  rad: { commission_source: string | null; commission_amount: number | string | null; proposed_commission_percent?: number | string | null },
): FormData {
  const formen = String(form.get("provision_form") ?? "").trim();
  const kopia = new FormData();
  for (const [k, v] of form.entries()) kopia.append(k, v);
  if (formen !== "") {
    if (rad.commission_source === "manual") return form;
    const tal = (k: string) => tolkaBelopp(String(form.get(k) ?? "").trim().replace(/%$/, ""));
    const oforandrad =
      formen === "procent"
        ? rad.proposed_commission_percent != null && tal("commission_percent") === Number(rad.proposed_commission_percent)
        : rad.commission_amount != null && tal("commission_amount") === Number(rad.commission_amount);
    if (!oforandrad) return form;
    for (const k of ["provision_form", "commission_amount", "commission_percent"]) kopia.delete(k);
    return kopia;
  }
  if (rad.commission_source !== "manual" || rad.commission_amount == null) return form;
  kopia.set("provision_form", "belopp");
  kopia.set("commission_amount", String(Number(rad.commission_amount)));
  kopia.delete("commission_percent");
  return kopia;
}

// =============================================================================
// TA BORT EN ORDERBILAGA (granskningen S10b, D23; beställarens ja 2026-10-23)
//
// Filen måste vara en orderbilaga PÅ DEN ORDERN. Förut prövades bara ordern, så
// ett fil-id från en annan order, eller en samtalsinspelning på den egna, togs
// bort lika gärna. Säljaren tar bort på sin egen order före godkännandet; en
// godkänd orders avtal är underlag och tas bort av säljchef, VD eller ekonomi.
// En makulerad order behåller sina filer.
// =============================================================================
export function bilagaBortNej(a: {
  orderId: string;
  status: string | null;
  egen: boolean;
  hanterare: boolean;
  fil: { sales_order_id: string | null; purpose: string | null; removed_at: string | null } | null;
}): string | null {
  if (!a.fil || a.fil.sales_order_id !== a.orderId || a.fil.purpose !== "sales_order") return "Filen hör inte till ordern.";
  if (a.fil.removed_at) return "Filen är redan borttagen.";
  if (a.status === "makulerad") return "En makulerad order behåller sina filer.";
  if (!a.hanterare && !a.egen) return "Du får inte ta bort något från någon annans order.";
  if (!a.hanterare && (a.status === "signerad" || a.status === "betald")) {
    return "En godkänd order behåller sitt avtal. Säljchef, VD eller ekonomi tar bort en fil som blev fel.";
  }
  return null;
}

// =============================================================================
// BEVAKA IGEN (granskningen S10b, D23; beställarens ja 2026-10-23)
//
// Ett "Förlänger inte" tas tillbaka av säljchef, VD och ekonomi när som helst
// (`aterupptaBevakning`), och av säljaren själv i tio minuter (`farAngraUtfall`).
// Bara ett avslutat utfall: ett förlängt avtal har en ny order som bevakas.
// =============================================================================
export function bevakaIgen(
  o: { renewal_outcome: string | null; renewal_by: string | null; renewal_at: string | null; salesperson_id: string },
  mig: string,
  hanterare: boolean,
  nu: number = Date.now(),
): "hanterare" | "egen" | { fel: string; status: number } {
  if (o.renewal_outcome === "forlangd") return { fel: "Avtalet är förlängt med en ny order, och den bevakas.", status: 400 };
  if (o.renewal_outcome !== "avslutad") return { fel: "Avtalet bevakas redan.", status: 400 };
  if (hanterare) return "hanterare";
  if (o.salesperson_id !== mig) return { fel: "Ordern finns inte.", status: 404 };
  if (farAngraUtfall(o, mig, nu)) return "egen";
  return { fel: "Ett utfall som är äldre än tio minuter tas tillbaka av säljchef, VD eller ekonomi.", status: 403 };
}
