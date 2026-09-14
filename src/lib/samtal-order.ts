/**
 * Vilken affär ett samtal hör till. Ren logik, inga importer.
 *
 * ===========================================================================
 * REGELN, OCH VARFÖR DEN SER UT SÅ HÄR
 *
 * Sömmen är telefonnumret. Ordern bär `contact_phone_e164` (genererad i 0056),
 * samtalet `counterpart_e164`, och båda är normaliserade av samma regel.
 *
 * **INGEN UNDRE TIDSGRÄNS.** Beställaren var uttrycklig: hitta alla samtal, även
 * de som ligger långt bakåt. En kund kan ha ringts i veckor innan affären
 * gick i lås, och det första samtalet är ofta det intressantaste — det är där
 * invändningarna finns. Ett fönster på "sju dagar före ordern" hade tyst kapat
 * bort dem, och ett tomt avsnitt ser likadant ut som en kund ingen ringt.
 *
 * **FLERA SAMTAL PER ORDER ÄR NORMALFALLET**, inte undantaget. Kopplingen är
 * många-till-en: `phone_call.sales_order_id` pekar på ordern, aldrig tvärtom.
 *
 * ===========================================================================
 * DEN SVÅRA BITEN: SAMMA NUMMER, FLERA AFFÄRER
 *
 * En kund som köper två gånger ger två order med samma nummer. Då måste
 * samtalen delas mellan dem, och det finns bara en rimlig delning:
 *
 *   Ett samtal hör till den FÖRSTA order som lades upp EFTER samtalet.
 *
 * Alltså: samtalen före affär 1 hör till affär 1. Samtalen mellan affär 1 och
 * affär 2 hör till affär 2 — det är de samtalen som ledde dit. Det som återstår
 * är samtal efter den sista ordern; de hör till den ordern, som uppföljning.
 *
 * Regeln är avsiktligt enkel, för den ska gå att förklara för den som undrar
 * varför ett samtal hamnade där det hamnade. En viktning på närhet i tid hade
 * gett bättre svar i enstaka fall och obegripliga svar i resten.
 *
 * ===========================================================================
 * VAD FUNKTIONEN ALDRIG GÖR
 *
 * Den tar aldrig bort en koppling som en människa gjort (`order_linked_by`
 * satt), och den lämnar aldrig ett samtal utan att det går att se varför. Ett
 * samtal utan nummer, eller med ett nummer ingen order bär, får `null` — och
 * syns då i listan över okopplade. Ingenting försvinner tyst.
 */

export type SamtalForKoppling = {
  id: string;
  counterpartE164: string | null;
  /** ISO. Samtal utan tidpunkt kan inte placeras mellan två affärer. */
  startedAt: string | null;
  salesOrderId: string | null;
  /** Satt = en människa bestämde. Röres inte. */
  orderLinkedBy: string | null;
};

export type OrderForKoppling = {
  id: string;
  contactPhoneE164: string | null;
  /** ISO. När ordern lades upp — inte när den signerades. */
  createdAt: string;
};

/** Vad en svepning vill skriva. `orderId: null` betyder "lös upp kopplingen". */
export type Koppling = {
  samtalId: string;
  orderId: string | null;
};

/**
 * Ordern ett enskilt samtal hör till, eller null.
 *
 * `ordrar` behöver inte vara filtrerad på nummer — funktionen gör det själv,
 * så att anroparen inte kan råka skicka in fel urval.
 */
export function valjOrder(
  samtal: SamtalForKoppling,
  ordrar: OrderForKoppling[],
): string | null {
  if (!samtal.counterpartE164) return null;

  const kandidater = ordrar.filter((o) => o.contactPhoneE164 === samtal.counterpartE164);
  if (kandidater.length === 0) return null;
  if (kandidater.length === 1) return kandidater[0].id;

  // Flera affärer på samma nummer. Utan tidpunkt på samtalet går de inte att
  // skilja åt — då är den äldsta ordern det minst godtyckliga svaret, och
  // samtalet syns ändå i listan på den ordern.
  const iTid = [...kandidater].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!samtal.startedAt) return iTid[0].id;

  const efter = iTid.find((o) => o.createdAt >= samtal.startedAt!);
  if (efter) return efter.id;

  // Inget lades upp efter samtalet — alltså uppföljning på den sista affären.
  return iTid[iTid.length - 1].id;
}

/**
 * Alla ändringar en svepning ska skriva.
 *
 * Returnerar BARA det som faktiskt skiljer sig. En svepning som skriver om
 * varje rad varje natt gör `updated_at` värdelös och döljer vad som ändrades.
 */
export function parIhop(
  samtal: SamtalForKoppling[],
  ordrar: OrderForKoppling[],
): Koppling[] {
  const ut: Koppling[] = [];

  for (const s of samtal) {
    // En människa har bestämt. Svepningen har inget här att göra — se
    // `order_linked_by` i 0056, och `phone_identity.created_by` i 0052 för
    // samma resonemang en gång till.
    if (s.orderLinkedBy) continue;

    const orderId = valjOrder(s, ordrar);
    if (orderId !== s.salesOrderId) ut.push({ samtalId: s.id, orderId });
  }

  return ut;
}

/**
 * Hur länge en inspelning utan affär sparas.
 *
 * Trettio dygn är inte en teknisk gräns utan ett svar på "hur länge kan det ta
 * innan vi vet om samtalet blev en affär". En order som läggs in senare än så
 * hör inte till samtalet på ett sätt någon minns.
 *
 * Fristen står här och inte i databasen därför att den ska gå att ändra utan en
 * migration — men den ska också gå att SE, och en siffra gömd i ett anrop mitt
 * i en fil är inte synlig. `docs/NASTA_SESSION.md` pekar hit.
 */
export const GALLRINGSFRIST_DYGN = 30;

/** När en inspelning som hämtas nu ska gallras, om den inte fått en affär. */
export function gallringsfrist(nu: Date = new Date()): string {
  const d = new Date(nu.getTime());
  d.setUTCDate(d.getUTCDate() + GALLRINGSFRIST_DYGN);
  return d.toISOString();
}
