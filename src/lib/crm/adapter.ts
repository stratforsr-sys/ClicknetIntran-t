import "server-only";

/**
 * Leveransens CRM bakom ett gränssnitt (0071, SPEC avsnitt 7).
 *
 * =============================================================================
 * NAV VET INTE VILKET CRM LEVERANSEN HAR
 *
 * Beställaren 2026-09-30: okänt än. Nav pratar därför bara med `CrmAdapter`,
 * och den som gäller i dag är den MANUELLA: kunden läggs in för hand i
 * leverans-CRM:et, kund-ID:t klistras in i Nav (`lk_koppla_crm`), och en
 * statusändring är något människan gör där. När API:t är känt skrivs en
 * adapter till och byts in i `adapter()` — ingenting annat i navet ändras.
 *
 * Allt som går ut loggas rått i `integration_log` av anroparen, innan det
 * tolkas, som `call_ingest` för växeln.
 * =============================================================================
 */

export type Crmstatus = "valkomnad" | "kickoff_bokad" | "i_produktion";

export type Crmorder = {
  order_id: string;
  kund: string;
  kontakt: string | null;
  telefon: string | null;
  epost: string | null;
  paket: string | null;
};

export type Crmoverlamning = {
  mal: string | null;
  lovat: string | null;
  basta_tid: string | null;
  risker: string | null;
};

export interface CrmAdapter {
  namn: string;
  /** Skapa kunden. Den manuella adaptern kan inte — `externtId` null. */
  skapaKund(order: Crmorder, overlamning: Crmoverlamning): Promise<{ externtId: string | null }>;
  /** Sätt status. Kastar vid fel, så att utkorgen försöker igen. */
  sattStatus(externtId: string, status: Crmstatus): Promise<void>;
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
  async skapaKund() {
    return { externtId: null };
  },
  async sattStatus() {
    // Ingenting att anropa. Anroparen har redan loggat vad som skulle ut.
  },
  async hamta() {
    return null;
  },
};

export function adapter(): CrmAdapter {
  return manuell;
}
