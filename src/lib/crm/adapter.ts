import "server-only";

import { inkio, inkioFarSkriva } from "./inkio";
import type { Inkioadress, Orderunderlag } from "./inkio-mappning";

/**
 * Leveransens CRM bakom ett gränssnitt (0071, SPEC avsnitt 7).
 *
 * =============================================================================
 * CRM:ET ÄR INKIO SEDAN 0074
 *
 * Beställaren 2026-09-30: okänt än — och därför fanns det här gränssnittet med
 * en MANUELL adapter, där kund-ID:t klistrades in för hand. 2026-10-07 blev det
 * känt: Inkio, Clicknets egna CRM. Nu gäller:
 *
 *   - En godkänd order läggs in i Inkio (`skapa`), kunden skapas om den saknas.
 *   - En makulerad order makuleras där (`makulera`) — när den som makulerar
 *     lämnat bocken "Makulera även i Inkio" kvar (0075).
 *   - Leveransens steg skrivs på kundens tidslinje (`tidslinje`, 0075): bokat,
 *     genomfört, ej svar, flyttat och inställt, för alla sex stegen.
 *
 * Utanför produktionen — eller utan nycklar — faller `adapter()` tillbaka på
 * den manuella, så att en preview aldrig skriver i Inkio (`inkioFarSkriva`).
 *
 * Allt som går ut loggas rått i `integration_log` av anroparen, innan det
 * tolkas, som `call_ingest` för växeln.
 * =============================================================================
 */

export type Crmstatus = "valkomnad" | "kickoff_bokad" | "i_produktion";

/** Det Nav vet om en godkänd order, i den form ett CRM behöver. */
export type Crmorder = {
  bolag: string;
  orgnr: string;
  kontakt: string | null;
  telefon: string | null;
  epost: string | null;
  saljarEpost: string | null;
  godkandAv: string | null;
  godkandDag: string | null;
  /** Kundens adress som säljaren skrev den (0075). Null på äldre order. */
  adress: Inkioadress | null;
  underlag: Orderunderlag;
  /** Avtalet eller samtalsinspelningen — det kunden sa ja i. */
  bevis: { filnamn: string; typ: string; data: Buffer } | null;
};

/** Vad ordern blev i CRM:et. */
export type Crmkoppling = {
  kundId: string;
  kundnummer: string | null;
  orderId: string;
  ordernummer: string | null;
  lage: "utkast" | "inskickad";
};

export interface CrmAdapter {
  namn: string;
  /** Lägg in ordern, och kunden om den saknas. Null när adaptern inte kan. */
  skapa(order: Crmorder): Promise<Crmkoppling | null>;
  /** Makulera ordern. "borta" = den fanns inte (längre) — utkast raderas. */
  makulera(crmOrderId: string, orsak: string | null): Promise<"makulerad" | "borta">;
  /** Sätt status. Kastar vid fel, så att utkorgen försöker igen. */
  sattStatus(externtId: string, status: Crmstatus): Promise<void>;
  /** En rad på kundens tidslinje (0075: leveransens steg). Kastar vid fel. */
  tidslinje(externtId: string, text: string): Promise<void>;
  /** Hämta kunden. Null när adaptern inte kan läsa. */
  hamta(externtId: string): Promise<{ externtId: string; status: string | null } | null>;
}

/**
 * Den manuella adaptern. `sattStatus` lyckas alltid när kund-ID:t finns —
 * det finns inget system att fråga — och det som skulle ha skickats står i
 * `integration_log`, så att den som för över det för hand ser det.
 */
export const manuell: CrmAdapter = {
  namn: "manuell",
  async skapa() {
    return null;
  },
  async makulera() {
    return "borta";
  },
  async sattStatus() {
    // Ingenting att anropa. Anroparen har redan loggat vad som skulle ut.
  },
  async tidslinje() {
    // Samma sak.
  },
  async hamta() {
    return null;
  },
};

export function adapter(): CrmAdapter {
  return inkioFarSkriva() ? inkio : manuell;
}
