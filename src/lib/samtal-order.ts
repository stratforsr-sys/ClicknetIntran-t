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
  /**
   * Orderns status. Utelämnad räknas som en levande order. Se `rang()` — en
   * makulerad order eller ett kvarglömt utkast ska inte ta samtalen från den
   * affär som faktiskt gäller.
   */
  status?: string;
};

/**
 * Vilka order på ett nummer som får samtalen, bäst först.
 *
 * Fram till 2026-10-08 räknades alla order lika, och då vann den som råkade
 * läggas upp först efter samtalet. Wallgrens visade vad det kostar: säljsamtalet
 * hamnade på den MAKULERADE ordern (lagd 11:55) och den betalda (lagd dagen
 * efter) stod utan samtal. IE Cleaning likadant med ett kvarglömt utkast.
 *
 * Makulerade och utkast får därför samtal bara när numret inte har någon
 * levande order — då är de ändå det enda svaret, och samtalet ska synas
 * någonstans.
 */
function rang(o: OrderForKoppling): number {
  if (o.status === "makulerad") return 2;
  if (o.status === "utkast") return 1;
  return 0;
}

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

  const allaPaNumret = ordrar.filter((o) => o.contactPhoneE164 === samtal.counterpartE164);
  if (allaPaNumret.length === 0) return null;

  // Bara den bästa rangen tävlar. Se `rang()`.
  const basta = Math.min(...allaPaNumret.map(rang));
  const kandidater = allaPaNumret.filter((o) => rang(o) === basta);
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

/* ------------------------------------------------------------------------- *
 * Säljsamtalet — kravet för att en order ska gå vidare
 * ------------------------------------------------------------------------- */

/**
 * Hur långt ett säljsamtal minst är. Beställaren 2026-10-08: samtalet på ordern
 * ska vara säljsamtalet, "inte ett kort 2 minuter samtal".
 *
 * Fem minuter är golvet, inte ett mått på ett bra samtal. Septembers säljsamtal
 * låg mellan elva och sjuttiotvå minuter; det kortaste som ändå var ett
 * säljsamtal (Mbix, TSL Motors) var drygt elva.
 */
export const MIN_SALJSAMTAL_SEKUNDER = 300;

/**
 * Hur långt efter att ordern lades upp ett samtal fortfarande räknas som
 * säljsamtalet. Webhooken kommer när inspelningen är klar — ofta en minut efter
 * att luren lagts på — och säljaren kan ha börjat fylla i ordern under samtalet.
 * Allt senare än så är uppföljning, inte affären.
 */
export const SALJSAMTAL_EFTER_MINUTER = 15;

/**
 * Senaste tidpunkt (ISO) ett samtal kan ha startat och ändå vara säljsamtalet:
 * det tidigaste av "ordern lades upp + 15 min" och "signeringsdagens slut".
 * Delas av spärren och av listan "Koppla säljsamtal", så att ingen kan koppla
 * ett samtal som spärren sedan underkänner.
 */
export function saljsamtalsgrans(orderSkapad: string, signerad?: string | null): string {
  let grans = new Date(new Date(orderSkapad).getTime() + SALJSAMTAL_EFTER_MINUTER * 60_000).toISOString();

  // Dygnets slut i svensk tid är som senast 23:59 UTC+2 — midnatt UTC dagen
  // efter ger alltså ett par timmars marginal och aldrig för lite.
  if (signerad && /^\d{4}-\d{2}-\d{2}$/.test(signerad)) {
    const dagenEfter = new Date(`${signerad}T00:00:00Z`);
    dagenEfter.setUTCDate(dagenEfter.getUTCDate() + 1);
    const slut = dagenEfter.toISOString();
    if (slut < grans) grans = slut;
  }

  return grans;
}

export type SamtalForBedomning = {
  id: string;
  employeeId: string | null;
  talkSeconds: number | null;
  /** ISO. */
  startedAt: string | null;
  recordingState: string;
};

export type Saljsamtalsbedomning =
  | { ok: true; samtalId: string; sekunder: number; harLjud: boolean }
  | { ok: false; skal: string };

function minuter(sekunder: number): string {
  const m = Math.floor(sekunder / 60);
  const s = sekunder % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/**
 * Har ordern ett säljsamtal från Lynes? Ren logik — anroparen läser samtalen.
 *
 * Säljsamtalet är SÄLJARENS EGET samtal på kundens nummer, ringt innan ordern
 * lades upp OCH senast på signeringsdagen, och minst `MIN_SALJSAMTAL_SEKUNDER`
 * långt. Det längsta sådana räknas.
 *
 * Signeringsdagen är med för att en order kan läggas in i efterhand. Aros Lås
 * signerades 1 september och lades in den 15:e; samtalen den 11:e och 14:e är
 * uppföljning, och utan den gränsen hade de godkänts som säljsamtalet. Någon annans samtal på numret är uppföljning eller förarbete, och
 * provisionen följer säljaren — så det är hens röst som ska finnas på ordern.
 */
export function bedomSaljsamtal(args: {
  samtal: SamtalForBedomning[];
  saljareId: string;
  /** ISO. När ordern lades upp. */
  orderSkapad: string;
  /** `YYYY-MM-DD`. Signeringsdagen — samtalet ligger senast den dagen. */
  signerad?: string | null;
}): Saljsamtalsbedomning {
  const grans = saljsamtalsgrans(args.orderSkapad, args.signerad);

  const saljarens = args.samtal.filter((s) => s.employeeId === args.saljareId);
  const fore = saljarens.filter((s) => s.startedAt !== null && s.startedAt <= grans);

  if (fore.length === 0) {
    return {
      ok: false,
      skal:
        saljarens.length > 0
          ? "Säljarens samtal på kundens nummer ringdes alla efter signeringen eller efter att ordern lades upp. Säljsamtalet saknas."
          : args.samtal.length > 0
            ? "Ordern har samtal på kundens nummer, men inget från säljaren själv. Säljsamtalet saknas."
            : "Det finns inget samtal från Lynes på kundens nummer. Stämmer numret på ordern?",
    };
  }

  const langsta = fore.reduce((a, b) => ((b.talkSeconds ?? 0) > (a.talkSeconds ?? 0) ? b : a));
  const sekunder = langsta.talkSeconds ?? 0;

  if (sekunder < MIN_SALJSAMTAL_SEKUNDER) {
    return {
      ok: false,
      skal: `Säljarens längsta samtal på kundens nummer är ${minuter(sekunder)}. Ett säljsamtal är minst ${MIN_SALJSAMTAL_SEKUNDER / 60} minuter.`,
    };
  }

  return { ok: true, samtalId: langsta.id, sekunder, harLjud: langsta.recordingState === "hamtad" };
}

/** När en inspelning som hämtas nu ska gallras, om den inte fått en affär. */
export function gallringsfrist(nu: Date = new Date()): string {
  const d = new Date(nu.getTime());
  d.setUTCDate(d.getUTCDate() + GALLRINGSFRIST_DYGN);
  return d.toISOString();
}
