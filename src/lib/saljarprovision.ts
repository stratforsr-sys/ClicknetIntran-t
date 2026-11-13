/**
 * Säljarens provision på EN affär: vilken grund som gäller och vad den ger.
 *
 * Ren logik — inga anrop, ingen import av Supabase. Se
 * `tests/tjansteprovision.mjs` (reglerna) och `tests/nav2-tjanst-paritet.mjs`
 * (webbläsarens `ndSim` mot den här funktionen).
 *
 * ===========================================================================
 * EN REGEL, ETT STÄLLE. Fram till 2026-11-13 stod samma if-kedja två gånger
 * på servern — i `raknaFramProvision` (godkännandet, som fryser beloppet) och i
 * `forhandsprovision` (Nav 2.0:s förhandsvisning av en inskickad order) — och
 * en tredje gång i webbläsaren (`ndSim` i utkast.html). Varje regeländring
 * måste då göras tre gånger, och den dag två av dem säger olika saker visar
 * kortet en provision som godkännandet inte fryser. Nu anropar båda
 * serverställena den här funktionen, och `tests/nav2-tjanst-paritet.mjs` kör
 * webbläsarens `ndSim` mot den, fall för fall.
 * ===========================================================================
 *
 * GRUNDERNA, I DEN ORDNING DE PRÖVAS:
 *
 *   1. HANDSATT PROCENT   godkännarens procent på nettot.
 *   2. HANDSATT BELOPP    godkännarens kronor.
 *   3. NETTOREGELN        utköp ELLER finans: 12 % (satsen i
 *                         `buyout_commission_rate`) av det som blir kvar av
 *                         affären, i stället för matrisen.
 *   4. FRI ORDER          utan något av ovan är det ett fel: den har ingen
 *                         matris att falla tillbaka på.
 *   5. MATRISEN           paketets fasta belopp, PLUS provisionen på varje
 *                         tilläggstjänst (0293).
 *
 * Chefens egen försäljning (40 % av nettot) väljs efteråt i `affarenFor`, och
 * för den hoppas 3 och 5:s tjänster över — talet här används då inte.
 *
 * ===========================================================================
 * FINANSEN GÅR GENOM NETTOREGELN SEDAN 2026-11-13. Beställaren:
 *
 *   *"när man väljer finans på en order så får säljaren samma provision det
 *   går inte. Ifall det bockas i finans så ska provisionen räknas på 12% av det
 *   som finns kvar till företaget. Samma sak med utköp."*
 *
 * Det ersätter beslutet 2026-10-09 ("matrisens fasta belopp oförändrat"). Det
 * som finns kvar är ordervärdet (tjänsterna inräknade) minus finansavgiften
 * minus utköpet — `netto` nedan, räknat av anroparen med `nettoEfterUtkop` och
 * `nettoEfterFinans`. Satsen är densamma som för utköp ("samma sak"), så
 * källan blir `buyout` på båda: den betyder "nettosatsen", och
 * `nettoregel` säger vilket avdrag som utlöste den.
 * ===========================================================================
 */

import { gallandeSats, type Sats, type Tjanst } from "./order.ts";
import { procentProvision, type Saljarkalla } from "./chefsprovision.ts";
import { utkopsprovision, type Utkopssats } from "./utkop.ts";
import { tjanstensProvision, utanProvision } from "./tjansteprovision.ts";

/** Vilket avdrag som gjorde att nettoregeln gäller. Null när den inte gör det. */
export type Nettoregel = "utkop" | "finans" | "utkop_finans";

export type Saljarunderlag = {
  paket: number;
  loptid: number;
  /** Signeringsdagen, "YYYY-MM-DD". Matrisraden slås upp på den. */
  signerad: string;
  /** Det som blir kvar: ordervärdet minus utköp minus finansavgift. */
  netto: number;
  /** Utköpet i kronor, redan silat genom `harUtkop` — null när inget utköp finns. */
  utkop: number | null;
  /** Affären går via finanspartnern. */
  finans: boolean;
  friOrder: boolean;
  /** Säljaren är chefen med egen sats (`arEgenForsaljning`). */
  chefenSaljer: boolean;
  /** Godkännarens egna tal, redan tolkade och prövade. Båda null = inget handsatt. */
  handsatt: { procent: number | null; belopp: number | null };
  /** Alla matrisrader; uppslaget sker här på paket, löptid och signeringsdag. */
  satser: Sats[];
  /** Nettosatsen som gällde på signeringsdagen (`gallandeUtkopssats`), eller null. */
  nettosats: Utkopssats | null;
  tjanster: Tjanst[];
};

export type Saljardel =
  | {
      klar: true;
      /** Säljarens provision FÖRE chefsregeln: grunden plus tjänsterna. */
      provision: number;
      kalla: Saljarkalla;
      /** Procenten bakom beloppet när grunden är en procent. */
      procent: number | null;
      /** Matrisraden, för `commission_rate_id`. Bara satt när källan är matrisen. */
      matrisrad: Sats | null;
      /** Grunden utan tjänsterna: matrisens belopp, nettoregelns eller det handsatta. */
      grund: number;
      /**
       * Tjänsterna med `provision_kr` satt när matrisen är grunden. Annars står
       * `provision_kr` null — tjänsterna ingår i grundens värde.
       */
      tjanster: Tjanst[];
      /** Summan av tjänsternas provision. Noll när de ingår i grunden. */
      tjansteprovision: number;
      /** Tjänster utan val. Bara möjligt när matrisen är grunden; godkännandet nekar då. */
      saknas: string[];
      nettoregel: Nettoregel | null;
    }
  | { klar: false; fel: string };

/** Vilket avdrag som utlöser nettoregeln, eller null. */
export function nettoregelFor(utkop: number | null, finans: boolean): Nettoregel | null {
  if (utkop !== null && finans) return "utkop_finans";
  if (utkop !== null) return "utkop";
  if (finans) return "finans";
  return null;
}

export const MATRIS_SAKNAS =
  "Ingen provisionssats gällde för den kombinationen på signeringsdagen. Sätt beloppet för hand med en anteckning.";
export const FRI_UTAN_PROVISION = "En order utanför paketreglerna behöver både ett ordervärde och en provision.";

/** Beskedet när nettosatsen saknas. Utköpets mening står kvar ordagrant, finansen får sin egen. */
export function nettosatsSaknas(regel: Nettoregel): string {
  return regel === "finans"
    ? "Ingen sats för finansaffärer gällde på signeringsdagen (samma sats som utköp). Lägg en sats under Provision → Regler, eller sätt beloppet för hand."
    : "Ingen utköpssats gällde på signeringsdagen. Lägg en sats under Provision → Regler, eller sätt beloppet för hand.";
}

/** Tjänsterna utan något räknat: de ingår i grunden, eller grunden är handsatt. */
const iGrunden = (tjanster: Tjanst[]): Tjanst[] => tjanster.map((t) => ({ ...t, provision_kr: null }));

export function saljarensProvision(u: Saljarunderlag): Saljardel {
  const nettoregel = nettoregelFor(u.utkop, u.finans);

  const klar = (
    grund: number,
    kalla: Saljarkalla,
    procent: number | null,
    matrisrad: Sats | null = null,
    tjanster: Tjanst[] = iGrunden(u.tjanster),
    saknas: string[] = [],
  ): Saljardel => {
    const tjansteprovision = tjanster.reduce((s, t) => s + (t.provision_kr ?? 0), 0);
    return {
      klar: true,
      provision: grund + tjansteprovision,
      kalla,
      procent,
      matrisrad,
      grund,
      tjanster,
      tjansteprovision,
      saknas,
      // Regeln står med bara när den faktiskt gav beloppet; en handsatt provision på en finansaffär är handsatt.
      nettoregel: kalla === "buyout" ? nettoregel : null,
    };
  };

  // 1–2. GODKÄNNARENS EGNA TAL GÅR FÖRE ALLT. Den som skrivit ett tal har sett
  // affären och bestämt sig; ingen sats ska överpröva det.
  if (u.handsatt.procent !== null) {
    return klar(procentProvision(u.netto, u.handsatt.procent), "manual", u.handsatt.procent);
  }
  if (u.handsatt.belopp !== null) return klar(u.handsatt.belopp, "manual", null);

  // 3. NETTOREGELN — utköp eller finans. Chefens egen order går förbi: hens sats
  // räknar redan på samma netto (`affarenFor`).
  if (nettoregel !== null && !u.chefenSaljer) {
    if (!u.nettosats) return { klar: false, fel: nettosatsSaknas(nettoregel) };
    return klar(utkopsprovision(u.nettosats, u.netto), "buyout", u.nettosats.percent);
  }

  // 4. En fri order har ingen matris att falla tillbaka på.
  if (u.friOrder && !u.chefenSaljer) return { klar: false, fel: FRI_UTAN_PROVISION };

  // 5. MATRISEN, och tjänsterna ovanpå den.
  const rad = gallandeSats(u.satser, u.paket, u.loptid, u.signerad);
  // Chefen behöver ingen matrisrad: hens belopp kommer ur nettot i `affarenFor`.
  if (!rad && !u.chefenSaljer) return { klar: false, fel: MATRIS_SAKNAS };

  // Chefens egen order: tjänsterna ingår i hens procent på nettot, inget räknas här.
  if (u.chefenSaljer) return klar(rad?.amount ?? 0, "matrix", null, rad);

  const tjanster = u.tjanster.map((t) => ({ ...t, provision_kr: tjanstensProvision(t, u.loptid) }));
  return klar(rad!.amount, "matrix", null, rad, tjanster, utanProvision(u.tjanster));
}

/**
 * Meningen som förklarar en nettoregel, eller tomt.
 *
 * "12 % av 42 000 kr som blev kvar efter finans 5 270 kr". Står i kvittensen,
 * i notisen och på kortet, så att den som ser 5 040 kr i stället för matrisens
 * 3 500 kr får veta varför i samma andetag.
 */
export function nettoregeltext(
  regel: Nettoregel | null,
  t: { procent: number; netto: number; utkop: number | null; finans: number | null },
  kr: (n: number) => string,
): string {
  if (!regel) return "";
  const avdrag =
    regel === "utkop_finans"
      ? `utköp ${kr(t.utkop ?? 0)} och finans ${kr(t.finans ?? 0)}`
      : regel === "utkop"
        ? `utköp ${kr(t.utkop ?? 0)}`
        : `finans ${kr(t.finans ?? 0)}`;
  return `${t.procent} % av ${kr(t.netto)} som blev kvar efter ${avdrag}`;
}
