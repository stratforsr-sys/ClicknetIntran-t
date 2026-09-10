/**
 * E13 steg 12: vad en rattad order gor med huvudboken.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `order.ts`, `chefsprovision.ts` och `provision-motor.ts`: filen ska
 * ga att prova utan att starta Next. Se `tests/rattelse.mjs`.
 *
 * ===========================================================================
 * EN ORDER I EN OPPEN MANAD BEHOVER INGENTING AV DEN HAR FILEN.
 *
 * Det ar vart att sla fast forst, for det ar det vanliga fallet. En oppen manad
 * raknas LIVE ur orderna varje gang nagon tittar (avsnitt 5.5). Rattas ordern
 * andras talet av sig sjalvt vid nasta lasning, och ingen post behover skrivas.
 *
 * Den har filen galler bara det andra fallet: ordern hor till en manad som
 * redan ar FASTSTALLD. Da finns det bokforda poster som sager vad som betalades
 * ut, de gar inte att skriva om (`commission_entry` ar append-only), och de
 * SKA inte skrivas om — lonespecen for den manaden ar redan utfardad.
 *
 * Svaret ar att bokfora SKILLNADEN i innevarande manad. Bestallarens val
 * 2026-09-09: *"Augusti orord — 1 500 kr star kvar. September far +1 000 kr."*
 * ===========================================================================
 *
 * INGET BELOPP OCH INGEN PROCENTSATS STAR I DEN HAR FILEN. Den raknar
 * skillnader mellan tva tal den far in.
 */

/**
 * Vad en order gav, sett som pengar till personer.
 *
 * BADA HALLEN AR VALFRIA. En order utan overtack — chefen sålde den sjalv, eller
 * ingen sats var satt — har `chef: null`, och det ar nagot annat an ett overtack
 * pa noll kronor: det senare skulle ge en nollpost, det forra ger ingen post.
 */
export type Utfall = {
  /** Saljaren och hens provision. */
  saljare: string;
  provision: number;
  /** Mottagaren av overtacket och beloppet, eller null nar inget bokfordes. */
  chef: string | null;
  overtack: number;
};

export type Rattelsepost = {
  employee_id: string;
  /** Signerat. Ett tillbakadrag ar ett negativt belopp, aldrig ett positivt med flagga. */
  belopp: number;
  /** Vad posten ar, pa svenska. Samma text i vyn och i huvudboken. */
  text: string;
};

/**
 * Skillnaden mellan tva utfall, som poster i huvudboken.
 *
 * ===========================================================================
 * BYTT PERSON GER TVA POSTER, INTE EN.
 *
 * Det ar filens enda egentliga svarighet, och den ar lätt att fa fel.
 *
 * Andras bara BELOPPET, med samma person kvar, racker EN post pa skillnaden:
 * 1 500 blir 2 500 ger +1 000 kr till samma manniska.
 *
 * Andras PERSONEN gar det inte att bilda nagon skillnad — de tva talen hor till
 * olika manniskor. Da maste hela det gamla beloppet tas tillbaka fran den forra
 * och hela det nya ges till den nya. En "skillnad" pa 1 000 kr hade lamnat
 * 1 500 kr kvar hos nagon som inte salde ordern.
 *
 * DETSAMMA GALLER MOTTAGAREN AV OVERTACKET. Den byter person nar satsen byter
 * mottagare, och nar en order gar fran en saljares till saljchefens eget namn —
 * da utgar overtacket helt (`chef: null`), och hela det gamla beloppet ska
 * tillbaka.
 * ===========================================================================
 *
 * NOLLPOSTER SKRIVS ALDRIG. En bokford nolla ar ingen upplysning, och i en
 * append-only tabell gar den inte att stada bort efterat — samma regel som
 * `bokforingsposter` i `provision-motor.ts` foljer.
 *
 * `text` bar orderns namn och datum eftersom posten hamnar i en HELT ANNAN
 * manad an affaren. Utan det star det "+1 000 kr" i september utan nagot satt
 * att se vad det galler.
 */
export function rattelseposter(fore: Utfall, efter: Utfall, orderstext: string): Rattelsepost[] {
  const poster: Rattelsepost[] = [];

  const lagg = (employee_id: string, belopp: number, vad: string) => {
    if (belopp === 0) return;
    poster.push({ employee_id, belopp, text: `${vad}: ${orderstext}` });
  };

  // ---------------------------------------------------------------------------
  // Provisionen
  // ---------------------------------------------------------------------------
  if (fore.saljare === efter.saljare) {
    lagg(efter.saljare, efter.provision - fore.provision, "Rättelse av provision");
  } else {
    lagg(fore.saljare, -fore.provision, "Ordern flyttad till annan säljare");
    lagg(efter.saljare, efter.provision, "Ordern flyttad hit");
  }

  // ---------------------------------------------------------------------------
  // Overtacket
  //
  // Fyra fall, och de tre sista ar de som gor att `chef` ar nullbar:
  //
  //   samma mottagare  -> skillnaden
  //   bytt mottagare   -> tillbaka fran den forra, ut till den nya
  //   fanns, nu inte   -> hela beloppet tillbaka  (ordern blev chefens egen)
  //   fanns inte, nu   -> hela beloppet ut        (en sats hann sattas)
  // ---------------------------------------------------------------------------
  if (fore.chef !== null && efter.chef !== null && fore.chef === efter.chef) {
    lagg(efter.chef, efter.overtack - fore.overtack, "Rättelse av övertäck");
  } else {
    if (fore.chef !== null) lagg(fore.chef, -fore.overtack, "Övertäcket tillbakadraget");
    if (efter.chef !== null) lagg(efter.chef, efter.overtack, "Övertäck efter rättelse");
  }

  return poster;
}

/**
 * Ar de tva utfallen lika i allt som ror pengar?
 *
 * Anvands for att slippa saga "rattad" om nagon bara andrat ett telefonnummer.
 * En rattelse som INTE ror pengar ska inte notifiera nagon om ett belopp, och
 * den ska inte heller pasta i loggen att en utbetalning andrats.
 */
export function rorPengar(fore: Utfall, efter: Utfall): boolean {
  return rattelseposter(fore, efter, "").length > 0;
}
