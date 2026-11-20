/**
 * Inkio-vakten — den rena logiken. Inget nätverk, ingen databas, så att den går
 * att prova utan Next (`tests/inkio-vakt.mjs`). Servern är `inkio-vakt-server.ts`.
 *
 * =============================================================================
 * VARFÖR DEN FINNS (2026-11-20)
 *
 * Toro Relining AB (#41) godkändes 2026-11-13 och kom aldrig in i Inkio: Inkio
 * svarade 422 "Välj vem som sålde affären", för att säljaren inte längre fanns
 * bland Inkios säljare. Utkorgen gav upp efter tre försök och skrev EN notis,
 * till admin, med rubriken "Utkorgen kunde inte skicka en rad" och texten
 * "Rad 9228 (crm)". Inget kundnamn, ingen länk till ordern, inget mejl, och
 * ingen sa något igen. Ordern låg stilla i sju dagar.
 *
 * Vakten säger det på tre sätt i stället:
 *
 *   1. EN ORDER SOM STÅR MED FEL MOT INKIO larmar med kundens namn, ordernumret
 *      och skälet i klartext, länkar till ordern och går till säljaren, den som
 *      godkände, säljarens chef, admin och superadmin. Mejl och telefon.
 *   2. DEN LARMAR IGEN varje dygn så länge felet står kvar, och bara på dagtid.
 *      Ett larm som kom en gång och lästes på kvällen är ett larm som glömts.
 *   3. SÄLJARE SOM SAKNAS I INKIO larmas innan de hinner fälla en order: en
 *      aktiv säljare i Nav med order det senaste kvartalet ska finnas bland
 *      Inkios säljare med samma e-postadress.
 *
 * Regel, inte AI: allt här är jämförelser av tider och adresser.
 * =============================================================================
 */

/** Ett nytt larm om samma sak tidigast efter ett dygn. */
export const LARMA_IGEN_MS = 24 * 60 * 60 * 1000;

/** Påminnelser bara 07–19 svensk tid. Det FÖRSTA larmet går när felet uppstår. */
export const DAGTID = { fran: 7, till: 19 } as const;

/** Timmen i Stockholm för ett ögonblick. */
export function stockholmsTimme(nu: Date): number {
  const h = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(nu);
  return Number(h);
}

/**
 * Ska det larmas nu? `senast` är förra larmet om samma sak (null: aldrig).
 * Första gången alltid. Därefter ett dygn senare, och då bara på dagtid —
 * ett fel kvart i fem på morgonen påminner hellre kl 07.
 */
export function attLarma(senast: Date | null, nu: Date): boolean {
  if (!senast) return true;
  if (nu.getTime() - senast.getTime() < LARMA_IGEN_MS) return false;
  const h = stockholmsTimme(nu);
  return h >= DAGTID.fran && h < DAGTID.till;
}

/**
 * Inkios felsvar, översatt till vad en människa gör. Okänt fel: Inkios egen
 * text står kvar, ordagrant — vakten gissar aldrig ett skäl den inte kan visa.
 */
export function skalOchAtgard(fel: string | null): { skal: string; atgard: string } {
  const text = (fel ?? "").trim() || "Inkio gav inget skäl.";
  const saknas = /Säljaren \(([^)]+)\) finns inte bland Inkios säljare/.exec(text);
  if (saknas) {
    return {
      skal: `säljaren (${saknas[1]}) finns inte i Inkio`,
      atgard: `Lägg till ${saknas[1]} som säljare i Inkio och tryck Försök igen på ordern.`,
    };
  }
  if (/Välj vem som sålde affären/i.test(text)) {
    return {
      skal: "säljaren finns inte i Inkio",
      atgard: "Lägg till säljaren i Inkio med samma e-post som i Nav och tryck Försök igen på ordern.",
    };
  }
  return { skal: text.replace(/^Inkio svarade \d+ på [A-Z]+ \S+:\s*/, ""), atgard: "Öppna ordern, rätta det som saknas och tryck Försök igen." };
}

export type Fastnad = {
  orderId: string;
  ordernummer: number | null;
  bolag: string;
  fel: string | null;
  /** När ordern godkändes. Dagarna räknas därifrån: `synced_at` börjar om vid varje Försök igen. */
  sedan: string | null;
};

function dagarSedan(sedan: string | null, nu: Date): number | null {
  if (!sedan) return null;
  const t = Date.parse(sedan);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nu.getTime() - t) / (24 * 60 * 60 * 1000));
}

/** Notisen för en order som står med fel. Rubriken ≤ 200 tecken och detaljen ≤ 300, som tabellen kräver. */
export function orderlarm(f: Fastnad, nu: Date): { rubrik: string; detalj: string; href: string } {
  const nr = f.ordernummer != null ? ` (#${f.ordernummer})` : "";
  const { skal, atgard } = skalOchAtgard(f.fel);
  const dagar = dagarSedan(f.sedan, nu);
  const hur = dagar && dagar >= 1 ? ` Har legat i ${dagar} ${dagar === 1 ? "dag" : "dagar"}.` : "";
  return {
    rubrik: `${f.bolag}${nr} har inte kommit in i Inkio`.slice(0, 200),
    detalj: `Skäl: ${skal}. ${atgard}${hur}`.slice(0, 300),
    href: `/order/${f.orderId}`,
  };
}

export type Saljare = { id: string; namn: string; epost: string };

/** Nav-säljarna vars e-post inte finns bland Inkios säljare. Skiftläge och mellanslag räknas inte. */
export function saknasIInkio(navSaljare: readonly Saljare[], inkioEpost: readonly string[]): Saljare[] {
  const finns = new Set(inkioEpost.map((e) => e.trim().toLowerCase()));
  return navSaljare.filter((s) => s.epost.trim() !== "" && !finns.has(s.epost.trim().toLowerCase()));
}

/** EN notis för alla som saknas, inte en per säljare ("jag vill inte få 100 mejl", 2026-11-02). */
export function saljarlarm(saknas: readonly Saljare[]): { rubrik: string; detalj: string; href: string } {
  const namn = saknas.map((s) => s.namn);
  const vem = namn.length === 1 ? namn[0] : `${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
  const adresser = saknas.map((s) => s.epost).join(", ");
  return {
    rubrik: (saknas.length === 1 ? `${vem} saknas som säljare i Inkio` : `${saknas.length} säljare saknas i Inkio`).slice(0, 200),
    detalj: `${vem}: nästa order de säljer kommer inte in i Inkio. Lägg till dem som säljare i Inkio med samma e-post som i Nav: ${adresser}.`.slice(0, 300),
    href: "/fel",
  };
}

/** Nyckeln för en uppsättning saknade säljare: samma uppsättning larmas en gång per dygn, en ny direkt. */
export function saljarnyckel(saknas: readonly Saljare[]): string {
  return `saljare:${saknas.map((s) => s.id).sort().join(",")}`;
}
