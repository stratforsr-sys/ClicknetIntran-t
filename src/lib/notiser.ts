/**
 * Notiserna i klockan. Typer och sortering — ren logik, inga importer.
 *
 * ===========================================================================
 * KLOCKAN BAR TVA SORTERS POST, OCH DE HAMTAS PA TVA OLIKA SATT
 *
 * "NAGOT VANTAR PA DIG" RAKNAS FRAM ur raderna som redan finns: en okvitterad
 * rutin, en publicerad kurs du inte gjort, ett nyhetsinlagg som riktar sig till
 * dig, ett svar i ditt arende. Skalet star i migration 0018 och det star kvar —
 * en notistabell kraver att varje producent kommer ihag att skriva sin rad, och
 * den som glommer ger en tyst lucka. En kurs som laggs upp utan att nagon far
 * veta ser precis ut som en kurs ingen brydde sig om.
 *
 * "NAGOT HANDE DIG" LASES UR `notification_event` (migration 0047). De posterna
 * gar inte att rakna fram, for handelsen SKRIVER OVER tillstandet den kom ur:
 * en godkand coachningsuppgift ar bara `klar`, en returnerad order ar `utkast`
 * igen, ett tillbakadraget avtal ar inte ens lasbart for den det galler. Fram
 * till 2026-09-03 saknade navet den halvan helt, och det var darfor den som
 * FICK sin uppgift godkand var den enda som inte fick veta hur det gick.
 *
 * Det enda som sparas om LASNINGEN ar fortfarande en tidpunkt per person: nar
 * du senast oppnade klockan.
 * ===========================================================================
 */

export type Notistyp =
  | "arende"
  | "nyhet"
  | "rutin"
  | "kurs"
  | "franvaro"
  | "fel"
  | "guide"
  | "coachning"
  | "order"
  | "avtal"
  | "lon"
  | "tid"
  | "konto"
  | "rekrytering"
  | "provision"
  | "kv";

/**
 * Ar strangen en av de sexton typerna?
 *
 * Behovs for att typen numera ocksa kan komma UR DATABASEN. En harledd post far
 * sin typ av koden som bygger den och kan inte vara fel; en rad i
 * `notification_event` bar en textkolumn, och en typ som inte finns hade slagit
 * ut `TYP_IKON[n.typ]` med ett odefinierat ikonnamn mitt i klockan.
 */
export function arNotistyp(varde: unknown): varde is Notistyp {
  return typeof varde === "string" && varde in TYP_ETIKETT;
}

/**
 * Alla sorters post klockan kan visa, som de heter i ett notis-id.
 *
 * Listan ar inte samma sak som `Notistyp`. Typen avgor ikon och etikett; det har
 * avgor VILKEN RAD posten kom ur, och tva poster med samma typ kan komma ur
 * olika hall — `franvaro-lucka` ar en pamminelse och `franvaro-beslut` ett
 * besked, bada med typen "franvaro".
 *
 * Varfor den finns: `avfardaNotis()` maste kunna avgora om en strang fran
 * klienten ar ett notis-id innan den skrivs. Alternativet — att rakna fram alla
 * notiser igen och leta i listan — hade kostat sjutton databasfragor pa ett
 * klick som samtidigt navigerar bort.
 *
 * ===========================================================================
 * LISTAN HAR TVA HALVOR, OCH SKILLNADEN AR INTE KOSMETISK
 *
 * HARLEDDA kallor raknas fram ur sina egna tabeller vid varje lasning
 * (`notiser-server.ts`). De svarar pa "NAGOT VANTAR PA DIG", och tillstandet
 * finns kvar i raden sa lange saken ar ogjord — darfor kan ingen producent
 * skapa en tyst lucka genom att glomma nagot. Det ar 0018:s val och det star.
 *
 * HANDELSEKALLOR ar rader i `notification_event` (0047), skrivna av den server
 * action som gjorde saken. De svarar pa "NAGOT HANDE DIG", och de gar inte att
 * harleda: handelsen SKRIVER OVER tillstandet. En returnerad order far status
 * `utkast` igen och ar da omojlig att skilja fran ett utkast som aldrig
 * skickats in; en godkand coachningsuppgift ar bara `klar`.
 *
 * NAR DU LAGGER TILL EN NY KALLA: valj halva efter den fragan, inte efter
 * vilken som ar enklast att skriva. En handelsekalla for nagot som vantar ger
 * en notis som ligger kvar sedan saken ar gjord.
 * ===========================================================================
 */
export const NOTIS_KALLOR = [
  // ---------------------------------------------------------------------------
  // HARLEDDA — raknas fram ur tabellerna vid lasning.
  // ---------------------------------------------------------------------------
  "nyhet",
  "rutin",
  "kurs",
  "arende",
  "franvaro",
  "franvaro-beslut",
  "franvaro-lucka",
  "sjuk",
  // E13 steg 6. Tva olika poster ur samma tabell, som `franvaro-lucka` och
  // `franvaro-beslut`: forslaget ar chefens att ta stallning till, konsekvensen
  // ar den beromdas besked. Ett forslag nar ALDRIG den det galler — RLS i 0037
  // slapper fram raden forst nar den ar beslutad.
  "franvaro-forslag",
  "franvaro-konsekvens",
  "rollspel",
  "rollspel-bedomt",
  "fel",
  "fel-svar",
  /**
   * G6. Tre poster av samma typ men ur olika hall, som franvarons tre:
   * `guide` ar min egen paminnelse om det jag inte gjort, `guide-knuff` ar nagon
   * som sagt till mig, och `guide-team` ar chefens rad om nagon som stannat av.
   */
  "guide",
  "guide-knuff",
  "guide-team",
  /**
   * Coachningen. Fyra poster av samma typ men ur olika hall, precis som
   * guidernas tre: `coachning-ny` ar en uppgift jag NYSS fatt, `coachning` ar
   * min egen uppgift som statt still, `coachning-kvittering` ar nagon annans
   * uppgift som vantar pa MIN bock, och `coachning-team` ar chefens rad om
   * nagon som inte coachats pa en manad.
   *
   * `coachning-ny` och `coachning` ar avsiktligt TVA kallor och inte en.
   * Den forsta ar ett BESKED — nagon har lagt upp nagot at dig — och den andra
   * ar en PAMINNELSE om att det statt still. Samma id hade betytt att den som
   * klickar bort beskedet ocksa klickar bort paminnelsen tre dygn senare.
   */
  "coachning-ny",
  "coachning",
  "coachning-kvittering",
  "coachning-team",
  /**
   * Navets egen slapplista — se `src/navnyheter/`. Skild fran "nyhet" med flit:
   * "nyhet" ar ett inlagg NAGON SKREV till en malgrupp, "navnyhet" ar en sak
   * som BYGGDES och som beror den vars roll kan anvanda den. De ligger dessutom
   * i olika hall — det ena i `news_post`, det andra i koden — och ett delat id
   * hade kunnat kollidera den dag ett inlagg far en slug som en slapp redan har.
   *
   * Delen efter kallan ar postens slug och inte ett uuid, sa den maste halla sig
   * till `[0-9a-zA-Z-]`. Provet i tests/navnyheter.mjs bevakar det.
   */
  "navnyhet",

  /**
   * Avtal, frister, certifikat, granskningar, bedomningar och provision — fem
   * vantelagen som redan STOD i sina tabeller utan att nagon fick veta.
   *
   * `avtal` ar ett utfardat anstallningsavtal du inte kvitterat med ett klick.
   * `sjuk-frist` ar en K37-frist (lakarintyg, FK-anmalan, rehabplan) som inte
   * ar avbockad. `certifikat-gar-ut` raknas ur `expires_at` och sager till i
   * god tid — en certifiering som redan gatt ut ar kursnotisens sak.
   * `rutin-granskning` galler dokumentets AGARE och ingen annan. `kv-bedomning`
   * ar en bedomning pa ditt eget samtal, `provision-bokford` en post i din egen
   * huvudbok.
   */
  "avtal",
  "sjuk-frist",
  "certifikat-gar-ut",
  "rutin-granskning",
  "kv-bedomning",
  "provision-bokford",

  // ---------------------------------------------------------------------------
  // HANDELSER — rader i `notification_event` (0047).
  //
  // Var och en skrivs av EN server action, och den som skriver ar den som
  // gjorde saken. Nyckelregeln star i `notifiera()`: en handelse gar aldrig
  // till den som utloste den. Chefen som godkanner en order behover ingen
  // notis om att hon nyss godkande en order.
  // ---------------------------------------------------------------------------

  /**
   * Coachningen. `coachning-godkand` ar tvillingen till `coachning`-postens
   * underkant-gren, och den saknades: fram till 2026-09-03 fick den vars
   * uppgift UNDERKANDES ett besked medan den vars uppgift GODKANDES fick
   * tystnad. Skalet var inte ett val utan att en klar uppgift filtreras bort
   * som "inte oppen" innan notiserna raknas.
   */
  "coachning-godkand",
  "coachning-avbruten",
  "coachning-samtal",

  /** Arendet. Tilldelningen till den som ska hantera, beslutet till agaren. */
  "arende-tilldelad",
  "arende-status",

  /**
   * Kundordern. Fem overgangar, och `order-makulerad` ar den som gor listan
   * nodvandig: en makulering RIVER saljarens provision i makuleringsmanaden,
   * och det ar det dyraste som kan handa nagon i navet utan att de far veta.
   */
  "order-inskickad",
  "order-godkand",
  "order-returnerad",
  "order-makulerad",
  "order-betald",

  /** Stamplingens rattelser. Begaran till chefen, beslutet till den anstallda. */
  "tid-rattelse",
  "tid-rattelse-beslut",

  /**
   * Schemat och rastavvikelserna.
   *
   * `tid-schema` galler ett schema pa en PERSON eller ett TEAM. Ett schema pa
   * bolagsniva ar en policy och notifieras inte — se undantagslistan i
   * `tests/notiser-tackning.mjs`.
   *
   * Avvikelsen gar at bada hallen: den anstallda kommenterar sin egen och
   * chefen avslutar den. Tva kallor, for det ar tva olika mottagare.
   */
  "tid-schema",
  "tid-avvikelse",
  "tid-avvikelse-avslutad",

  /**
   * Lonen. Attesten LASER perioden, justeringen andrar minuter EFTER att den
   * lasts (AC-2.16) — och den andra ar den som verkligen behover ett besked.
   */
  "lon-attesterad",
  "lon-justering",

  /**
   * Franvaron, de fyra overgangar som skriver over sitt eget spar.
   * `franvaro-installd` galler en REDAN GODKAND ledighet — den anstallda har
   * planerat efter ett besked som inte langre galler.
   */
  "franvaro-tillbakadragen",
  "franvaro-installd",
  "sjuk-bekraftad",
  "sjuk-avslutad",
  "sjuk-installd",
  "franvaro-saldo",

  /**
   * Den HAVDA konsekvensen.
   *
   * `franvaro-konsekvens` ar beskedet om att en varning eller ett bonusavdrag
   * registrerats. Havs beslutet forsvinner den posten — statusen blir `havd`
   * och harledningen slutar tracka. Den som fatt beskedet ska da fa veta att
   * det inte langre galler, och det ar bara en handelserad som kan sagra det.
   */
  "franvaro-havd",

  /**
   * Avtalet. Bara tillbakadragningen ar en handelse — utfardandet harleds ovan.
   * Skalet ar RLS i 0028: den anstallda ser sitt avtal bara medan det ar
   * `issued`, sa ett tillbakadraget avtal FORSVINNER ur hennes vy. Utan raden
   * hade beskedet varit omojligt att ge.
   */
  "avtal-tillbakadraget",

  /** Rutinen som arkiverades av nagon annan an dess agare. */
  "rutin-arkiverad",

  /** Kontot. Fyra saker om en sjalv som man har ratt att fa veta direkt. */
  "konto-roll",
  "konto-behorighet",
  "konto-losenord",
  "konto-aktiverad",
  /** Ny chef eller nytt team. Andrar vem som beslutar om din ledighet. */
  "konto-organisation",

  /** Rekryteringen. Gar till rekryteringskretsen, aldrig till kandidaten. */
  "rekrytering-ny",
  "rekrytering-steg",
  "rekrytering-noshow",
  "rekrytering-anstalld",

  /** Nagon lade upp en anstalld som du ar chef for. */
  "personal-ny",

  /**
   * ANGRA-KNAPPEN HAR MED FLIT INGEN KALLA HAR.
   *
   * `/angra` provades och togs bort igen. Kvittot med angra-knappen visas bara
   * for den som NYSS gjorde atgarden — den ligger i en kaka i hennes eget svar
   * — och varje gren i `angra` gor om hela behorighetskontrollen. Angraren och
   * den som gjorde saken ar alltsa samma person, inom nagra sekunder, och
   * `notifiera()` skickar aldrig till aktoren sjalv.
   *
   * En kalla har hade darfor varit en rad kod som aldrig kordes till slut. Det
   * som behover kunna foljas ar att bada handelserna star i `audit_log` — den
   * ursprungliga atgarden suddas inte, angringen laggs bredvid.
   */
] as const;

export type Notiskalla = (typeof NOTIS_KALLOR)[number];

/**
 * Kallorna som kommer ur `notification_event` i stallet for ur en harledning.
 *
 * Listan ar en DELMANGD av `NOTIS_KALLOR` och kontrolleras av typen nedan, sa
 * en felstavning faller i typkontrollen i stallet for att bli en notis som
 * aldrig gar att avfarda. Den anvands av `notifiera()` for att neka en kalla
 * som egentligen ar harledd — en handelserad for `rutin` hade legat kvar i
 * klockan efter att rutinen kvitterats.
 */
export const HANDELSEKALLOR = [
  "coachning-godkand",
  "coachning-avbruten",
  "coachning-samtal",
  "arende-tilldelad",
  "arende-status",
  "order-inskickad",
  "order-godkand",
  "order-returnerad",
  "order-makulerad",
  "order-betald",
  "tid-rattelse",
  "tid-rattelse-beslut",
  "tid-schema",
  "tid-avvikelse",
  "tid-avvikelse-avslutad",
  "lon-attesterad",
  "lon-justering",
  "franvaro-tillbakadragen",
  "franvaro-installd",
  "sjuk-bekraftad",
  "sjuk-avslutad",
  "sjuk-installd",
  "franvaro-saldo",
  "franvaro-havd",
  "avtal-tillbakadraget",
  "rutin-arkiverad",
  "konto-roll",
  "konto-behorighet",
  "konto-losenord",
  "konto-aktiverad",
  "konto-organisation",
  "rekrytering-ny",
  "rekrytering-steg",
  "rekrytering-noshow",
  "rekrytering-anstalld",
  "personal-ny",
] as const satisfies readonly Notiskalla[];

export type Handelsekalla = (typeof HANDELSEKALLOR)[number];

/**
 * Bygger ett notis-id.
 *
 * ALLA ID:N GAR GENOM DEN HAR FUNKTIONEN, och det ar hela poangen: listan ovan
 * och listan i `notiser-server.ts` kan da inte glida isar, for det finns bara en
 * lista. Skrivs en ny sorts notis med ett hopskrivet `\`nagot-${id}\`` faller
 * typkontrollen i stallet for att avfardningen tyst slutar fungera for just den.
 *
 * DELARNA BAR ATERUPPSTANDELSEN. `notisId("rutin", dok.id, dok.version)` ger ett
 * nytt id nar rutinen far en ny version, sa den dyker upp igen aven for den som
 * klickade bort forra versionen. Samma sak med meddelandets id i ett arende.
 * Skicka darfor med det som gor posten ny — inte bara radens id.
 */
export function notisId(kalla: Notiskalla, ...delar: (string | number)[]): string {
  return [kalla, ...delar].join("-");
}

/**
 * Ar strangen formad som ett notis-id?
 *
 * Bara formen provas, aldrig att posten finns. Det varsta ett paitat men
 * valformat id kan stalla till ar en rad som doljer en notis som inte finns —
 * i den avfardandes egen tabell, som ingen annan laser.
 */
export function arNotisId(varde: unknown): varde is string {
  if (typeof varde !== "string" || varde.length < 3 || varde.length > 200) return false;
  const kalla = NOTIS_KALLOR.find((k) => varde.startsWith(k + "-"));
  if (!kalla) return false;
  // Delarna ar uuid:er och heltal. Allt annat ar nagon som provar.
  return /^[0-9a-zA-Z-]+$/.test(varde.slice(kalla.length + 1));
}

export type Notis = {
  /** Stabil over sidladdningar — den bar "last"-markeringen medan panelen ar oppen. */
  id: string;
  typ: Notistyp;
  rubrik: string;
  detalj: string;
  href: string;
  /** ISO. Nar saken dok upp, inte nar den lastes. */
  tidpunkt: string;
  olast: boolean;
  /**
   * Posten forsvinner INTE av att klickas — den kraver att mottagaren sager att
   * hen last den.
   *
   * Regeln i klockan ar annars att ett klick ar att ta hand om posten: rutinen
   * ligger kvar pa /rutiner anda, sa raden har gjort sitt sa fort man gatt dit.
   * En slapplista har ingen sadan andra plats — texten ar hela saken, och den
   * som klickar for att LASA den ska inte samtidigt ha kvitterat att hon last
   * den. Bekraftelsen sitter i stallet under texten.
   *
   * Odefinierat pa allt annat, alltsa oforandrat beteende for de sjutton andra
   * posterna.
   */
  bekraftas?: boolean;
};

export const TYP_ETIKETT: Record<Notistyp, string> = {
  coachning: "Coachning",
  guide: "Guide",
  arende: "Ärende",
  nyhet: "Nyhet",
  rutin: "Rutin",
  kurs: "Utbildning",
  franvaro: "Frånvaro",
  fel: "Fel",
  order: "Order",
  avtal: "Avtal",
  lon: "Lön",
  tid: "Tid",
  konto: "Konto",
  rekrytering: "Rekrytering",
  provision: "Provision",
  kv: "K&V",
};

export const TYP_IKON: Record<Notistyp, string> = {
  coachning: "kontroll",
  guide: "utbildning",
  arende: "meny",
  nyhet: "logg",
  rutin: "rutiner",
  kurs: "utbildning",
  franvaro: "klocka",
  fel: "varning",
  order: "kontroll",
  avtal: "rutiner",
  lon: "logg",
  tid: "tid",
  konto: "konto",
  rekrytering: "personal",
  provision: "logg",
  kv: "kontroll",
};

/**
 * Hur manga poster klockan visar.
 *
 * En lista som aldrig tar slut ar en lista man slutar oppna. Det som inte far
 * plats har finns kvar i "Att gora" pa startsidan och i sin egen modul — inget
 * forsvinner, det slutar bara tranga sig fram.
 *
 * HOJD FRAN 15 TILL 25 2026-09-03, nar antalet kallor gick fran tjugoen till
 * femtio. Femton platser var rikligt sa lange bara halva navet notifierade;
 * med resten inne hade en enda dags order, rattelser och kvitteringar kunnat
 * trycka ut allt annat. Talet ar fortfarande ett TAK och inte ett mal —
 * knapparna "Markera alla som lasta" och krysset per rad ar det som gor en
 * langre lista hanterbar, och utan dem hade hojningen varit fel.
 */
export const MAX_NOTISER = 25;

/**
 * Sa gamla handelser far bli innan klockan slutar visa dem.
 *
 * Galler BARA `notification_event` (0047). En harledd post har ingen alder att
 * ga pa — en okvitterad rutin fran i varas ar lika okvitterad i dag, och att
 * dolja den for att den ar gammal hade varit att dolja arbetet, inte notisen.
 *
 * En handelse ar tvartom en upplysning med bast-fore-datum: "din order
 * godkandes" sager ingenting nytt efter en manad. Nattjobbet raderar raden
 * efter 90 dagar; det har talet ar var lange den SYNS.
 */
export const HANDELSE_DAGAR = 30;

/** Nyast forst. Olasta gar fore lasta aven om de ar aldre. */
export function sortera(notiser: Notis[]): Notis[] {
  return [...notiser].sort((a, b) => {
    if (a.olast !== b.olast) return a.olast ? -1 : 1;
    return b.tidpunkt.localeCompare(a.tidpunkt);
  });
}

/** "3 min", "2 tim", "igår", "12 aug". Klockslag pa en veckogammal notis
 *  ar en precision ingen har nagon nytta av. */
export function narTid(iso: string, nu: Date = new Date()): string {
  const minuter = Math.floor((nu.getTime() - Date.parse(iso)) / 60000);
  if (minuter < 1) return "nyss";
  if (minuter < 60) return `${minuter} min`;
  if (minuter < 24 * 60) return `${Math.floor(minuter / 60)} tim`;
  if (minuter < 48 * 60) return "igår";

  const d = new Date(iso);
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}
