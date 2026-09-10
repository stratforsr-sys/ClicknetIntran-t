import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";
import { stampelfri } from "@/lib/stampelfri";
import { AVDELNINGAR, avdelningFor } from "@/lib/avdelningar";

export type NavItem = {
  href: string;
  label: string;
  ikon: string;
  raknare?: number;
};

/**
 * En meny i sidopanelen. `id` ar en `AvdelningId`, eller `"mitt"`.
 *
 * Posterna ligger platt. Menyn ar redan avgransningen — ett fack inuti facket
 * hade betytt att man valjer avdelning en gang for att sedan valja avdelning
 * igen.
 */
export type NavMeny = {
  id: string;
  etikett: string;
  ikon: string;
  poster: NavItem[];
};

export type Navigering = {
  /** Posterna som alltid star framme i panelen. */
  snabb: NavItem[];
  /** Menyerna, i den ordning de ska ritas. Tomma menyer finns inte med. */
  menyer: NavMeny[];
};

/**
 * Sidopanelen visar bara moduler som faktiskt ar byggda. Dodlankar med
 * "kommer snart" ar samre an en kort meny — de larr anvandaren att menyn ljuger.
 * Listan vaxer nar varje modul levereras.
 *
 * ===========================================================================
 * MENYN ÄR AVDELNINGAR, INTE ROLLER (2026-09-09)
 *
 * Listan hade vuxit till arton poster. Alla var behörighetsprövade och alla
 * hörde hemma i navet, men arton likadana rader i en spalt är inte en meny —
 * det är en innehållsförteckning man läser varje gång i stället för att sikta.
 *
 * Nu står bara det man gör VARJE DAG framme. Resten ligger i menyer som öppnar
 * en spalt bredvid panelen, och menyerna ÄR AVDELNINGARNA: Försäljning,
 * Ekonomi, Personal, System. Plus **Min vy** för det som bara handlar om en
 * själv och därför inte hör till någon avdelning.
 *
 * FÖRSTA FÖRSÖKET LA EN "CHEFSVY" OVANPÅ AVDELNINGARNA, och det var fel.
 * Beställarens dom 2026-09-09: menyerna ska följa avdelningen, inte rollen.
 * Skälet håller: en meny som heter "Chefsvy" tvingar fram ett extra klick för
 * alla, den kräver att man vet om man räknas som chef för att gissa var en
 * sida ligger, och den delar upp SAMMA avdelnings sidor i två menyer beroende
 * på vem som tittar. "Order ligger under Försäljning" är sant för alla.
 *
 * TRE REGLER BÄR FILEN, OCH ALLA ÄR LÄTTA ATT BRYTA MOT AV MISSTAG:
 *
 * 1. **PLACERINGEN BEROR ALDRIG PÅ ROLLEN.** En sida hör till en avdelning,
 *    punkt. Flera sidor är två vyer i en — `/order` är säljarens egna order
 *    och säljchefens godkännandekö, `/avtal` är mitt anställningsavtal och
 *    chefens mallar — men de ligger på samma ställe för båda. Det är ETIKETTEN
 *    som får skilja, eftersom den beskriver vad sidan visar. Flyttas en post
 *    beroende på vem som tittar är vi tillbaka i rollmenyerna.
 *
 * 2. **EN POST HAMNAR PÅ EXAKT ETT STÄLLE.** Följer av regel 1, men värd att
 *    säga: står samma länk i två menyer är den långa listan tillbaka, bara
 *    utspridd.
 *
 * 3. **MENYN DELAR INTE UT NÅGOT.** Varje villkor nedan är oförändrat från den
 *    platta listan. Åtkomsten avgörs av roller, behörigheter och RLS — den här
 *    filen avgör bara var posten hamnar. En post som flyttas mellan menyer får
 *    aldrig byta villkor på vägen.
 *
 * En meny som inte fick några poster ritas inte alls. Det är samma regel som
 * gällde de enskilda posterna, och den är viktigare här: en tom "Ekonomi" är
 * ett löfte om en behörighet man inte har.
 * ===========================================================================
 */
export function navFor(user: CurrentUser | null, stamplingPa: boolean): Navigering {
  /**
   * Det man gör varje dag. Fem poster, och det är taket — varje ny post här
   * är en post som listan växte tillbaka med.
   *
   * Utbildningen står med trots att den inte öppnas dagligen: "Kom igång"-turen
   * pekar på den i menyn, och ett steg som pekar in i en stängd flyout är ett
   * steg som visar "elementet saknas" för varenda ny anställd. Se
   * src/guider/kom-igang.ts.
   */
  const snabb: NavItem[] = [{ href: "/", label: "Hem", ikon: "hem" }];

  /**
   * Posterna samlas platt och sorteras in på slutet. Nyckeln är menyns id.
   *
   * Fördelen mot att bygga menyerna direkt är att en meny som aldrig fick något
   * inte behöver städas bort efteråt — den uppstod aldrig.
   */
  const fack = new Map<string, NavItem[]>();
  const lagg = (meny: string, post: NavItem) => {
    const lista = fack.get(meny);
    if (lista) lista.push(post);
    else fack.set(meny, [post]);
  };

  if (user?.employee) {
    // Nyheter fore rutiner: det ar det som andras oftast, och den som inte
    // hittar dit last aldrig beskedet.
    snabb.push({ href: "/nyheter", label: "Nyheter", ikon: "logg" });
    snabb.push({ href: "/rutiner", label: "Rutiner", ikon: "rutiner" });
    snabb.push({ href: "/utbildning", label: "Utbildning", ikon: "utbildning" });

    /**
     * K12: posten dyker upp forst nar modulen slas pa. En meny som pekar pa en
     * funktion som inte far anvandas ar samre an ingen post alls.
     *
     * DEN STAMPELFRIA ROLLEN BEHALLER POSTEN OM DEN HAR ETT ARENDE TILL SIDAN.
     * /tid ar tva vyer i en: den egna stamplingen och chefens. Saljchefen
     * beslutar om rattelser och ser vilka som ar pa plats, och VD nar
     * "Ogiltig franvaro" darifran — bada slutar stampla, men ingen av dem ska
     * forlora vagen till sin ko. Ekonomi och projektledare har varken det ena
     * eller det andra kvar, och for dem forsvinner posten. Loneunderlaget ar en
     * EGEN post i ekonomimenyn och paverkas inte.
     *
     * Posten star bland snabbposterna och inte i en meny: stamplingen ar dagens
     * forsta och sista handling, och den ska inte ligga bakom ett klick till.
     */
    const stamplarSjalv = stamplingPa && !stampelfri(user.roles);
    const harKoPaTid = stamplingPa && (canManageEmployees(user) || hasRole(user, "ceo"));
    if (stamplarSjalv || harKoPaTid) snabb.push({ href: "/tid", label: "Tid", ikon: "tid" });

    // Arenden galler alla: den anstallda ser sina egna, chefen ser inkorgen.
    // Chefens inkorg AR hens egna arenden, sa posten hor hemma i Min vy for
    // bada — den handlar om vad jag har att gora, inte om en avdelning.
    lagg("mitt", { href: "/arenden", label: "Ärenden", ikon: "meny" });

    // E7 galler alla och kraver inte stampling: en semesteransokan hanger inte
    // pa om K12 ar avgjord. Bara paminnelserna om oregistrerad franvaro gor
    // det, och de hanteras i nattjobbet.
    lagg("mitt", { href: "/franvaro", label: "Frånvaro", ikon: "klocka" });

    /**
     * E0.6. Posten galler ALLA som har en anstalldrad.
     *
     * Det ar avsiktligt att saljaren ser den. En felrapportering som bara
     * cheferna hittar till rapporterar bara de fel cheferna sjalva ramlar pa,
     * och X7-piloten gar ut pa tre personer som inte ar chefer.
     *
     * Den ligger i Min vy och inte under System, aven for den som far
     * INKORGEN. Att rapportera ett fel ar nagot man gor sjalv, mitt i nagot
     * annat, och en bugg man maste oppna en systemmeny for att anmala blir
     * inte anmald. Etiketten skiljer — sidan visar olika saker, RLS avgor —
     * men vagen dit ar densamma for alla.
     */
    lagg("mitt", {
      href: "/fel",
      label: hasRole(user, "sales_manager", "ceo", "admin") ? "Fel" : "Rapportera fel",
      ikon: "varning",
    });

    /**
     * E13. Posten galler alla, och visar olika saker beroende pa vem som
     * oppnar den — RLS i 0031 avgor. Saljaren ser sin EGEN intjanade
     * provision; ekonomi och VD ser allas och bokfor dem.
     *
     * Skillnaden mot lonekostnaden ar avsiktlig. Den raden ar bolagets kalkyl
     * PA en person och stangd for alla utom `payroll_cost_viewer`. Den har ar
     * personens egen intjaning, och att kunna se vad man arbetat ihop utan att
     * be nagon leta upp det ar hela nyttan.
     *
     * Den ligger under Forsaljning och inte i Min vy: provisionen ar
     * forsaljningens matare, och den saljare som soker sina pengar soker dem
     * dar order och K&V ligger.
     */
    lagg("forsaljning", { href: "/provision", label: "Provision", ikon: "kontroll" });

    /**
     * Coachningen star bredvid utbildningen och inte under den, for att de
     * svarar pa olika fragor: utbildningen ar INNEHALLET, coachningen ar
     * uppfoljningen av personer. Darfor Personal och inte Forsaljning — den
     * galler alla anstallda, inte bara dem som saljer.
     *
     * Posten galler ALLA och visar olika saker beroende pa vem som oppnar den.
     * Chefen far lagvyn; alla andra skickas till sitt eget kort. En saljare som
     * inte hittar till sina egna coachningsuppgifter gor dem inte.
     */
    lagg("personal", { href: "/coachning", label: "Coachning", ikon: "kontroll" });
  }

  /**
   * E13 steg 1. ORDER, inte avtal — `/avtal` ar anstallningsavtal och har
   * ingenting med kundaffarer att gora.
   *
   * Kretsen ar smalare an provisionens: bestallarens besked 2026-08-24 var att
   * provisions- och bonussystemet galler ROLLEN SALJARE. En projektledare har
   * inga order och ska inte ha en meny som pastar motsatsen. Saljchef, VD och
   * ekonomi ser posten for att de godkanner och makulerar.
   */
  if (hasRole(user, "salesperson", "sales_manager", "ceo", "finance")) {
    lagg("forsaljning", { href: "/order", label: "Order", ikon: "kontroll" });
  }

  /**
   * E13 steg 5. K&V-protokollet. Samma krets som ordern, och av samma skal:
   * bonussystemet galler rollen SALJARE.
   *
   * Saljaren ser sina egna bedomningar och sin utvecklingskurva; saljchefen och
   * VD ser rutnatet och bedomer. Ekonomi ser bedomningarna eftersom de paverkar
   * provisionen, men satter dem inte.
   */
  if (hasRole(user, "salesperson", "sales_manager", "ceo", "finance")) {
    lagg("forsaljning", { href: "/kv", label: "K&V", ikon: "kontroll" });
  }

  // Loneunderlaget ar ledningens och ekonomins (AC-2.13). Teamledaren har
  // avvikelsevyn, inte den har. Posten foljer M2: utan stampling finns inget
  // underlag att rapportera.
  if (stamplingPa && hasRole(user, "sales_manager", "ceo", "finance", "admin")) {
    lagg("ekonomi", { href: "/tid/lonerapport", label: "Lönerapport", ikon: "klocka" });
  }

  // K26/E15.1: lonekostnad ar en EGEN behorighet, inte en roll. Posten dyker
  // upp for den som har `payroll_cost_viewer` och for ingen annan — ekonomi
  // utan den ser den inte, och saljchefen ser den inte heller om hen inte
  // fatt den tilldelad. Kretsen som ser vad folk KOSTAR ar mindre an den som
  // skoter loner.
  if (user?.permissions.includes("payroll_cost_viewer")) {
    lagg("ekonomi", { href: "/lonekostnad", label: "Lönekostnad", ikon: "kontroll" });
  }

  /**
   * Personalregistret heter **Anställda** i menyn och inte "Personal".
   *
   * Menyn den ligger i heter redan Personal, och "Personal › Personal" laser
   * som ett fel aven nar det inte ar det. "Anstallda" sager dessutom vad sidan
   * faktiskt ar: listan over personer. Adressen `/personal` star kvar — den ar
   * bokmarkt, den star i guider och i loggen, och ett namnbyte i menyn ar inte
   * skal nog att bryta lankar.
   */
  if (canManageEmployees(user) || hasRole(user, "ceo", "team_lead")) {
    lagg("personal", { href: "/personal", label: "Anställda", ikon: "personal" });
  }

  /**
   * E10. Q71: FLERA PERSONER REKRYTERAR, och vilka det ar foljer inte av
   * rollen. Ledningen far posten pa rollen sa att modulen fungerar direkt;
   * alla andra far den tilldelad som `recruiter` under Personal.
   *
   * Skillnaden mot K26 ar avsiktlig. Lonekostnad kraver behorigheten AV ALLA,
   * och det ar en av sakerna som fortfarande maste goras for hand innan den
   * vyn visar nagot. Rekrytering ska inte krava samma steg for att ens starta.
   */
  if (hasRole(user, "sales_manager", "ceo", "admin") || user?.permissions.includes("recruiter")) {
    lagg("personal", { href: "/rekrytering", label: "Rekrytering", ikon: "personal" });
  }

  /**
   * E9.1. Posten galler tva olika saker beroende pa vem som ser den, och det
   * ar avsiktligt att den finns for bada.
   *
   * Den som hanterar avtal ser mallarna och alla avtal. Alla andra ser sina
   * EGNA utfardade avtal, och att kunna lasa sitt eget anstallningsavtal utan
   * att be nagon leta upp det ar hela nyttan for dem som inte ar chefer.
   * RLS i 0028 avgor skillnaden.
   *
   * BADA hittar den under Personal. Ett anstallningsavtal ar en personalfraga
   * oavsett vilken sida av det man star pa — bara etiketten skiljer.
   */
  if (user?.employee) {
    lagg("personal", {
      href: "/avtal",
      label: hasRole(user, "sales_manager", "ceo", "admin") ? "Avtal" : "Mitt avtal",
      ikon: "rutiner",
    });
  }

  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    lagg("system", { href: "/logg", label: "Händelselogg", ikon: "logg" });
    // E6.5. Samma krets som handelseloggen. Teamledaren star utanfor: adoption
    // ar en fraga om navet, inte om hennes team, och en siffra per team hade
    // varit ett steg mot den per-person-uppfoljning 0029 ar byggd for att inte
    // gora mojlig.
    lagg("system", { href: "/adoption", label: "Adoption", ikon: "kontroll" });
  }

  if (hasRole(user, "admin")) {
    lagg("system", { href: "/design", label: "Designsystem", ikon: "design" });
  }

  /**
   * Ordningen: Min vy forst, sedan den EGNA avdelningen, sedan resten i
   * avdelningsordning.
   *
   * Hemvisten hoistas i stallet for att markeras, eftersom en meny man oppnar
   * varje dag ska ligga dar handen redan ar. Det ar ocksa den enda kvarvarande
   * anvandningen av `avdelningFor()` — och darmed det som gor funktionen vard
   * att byta ut den dag avdelningen star pa den anstallda.
   */
  const hem = avdelningFor(user);
  const ordnade = [
    ...AVDELNINGAR.filter((a) => a.id === hem),
    ...AVDELNINGAR.filter((a) => a.id !== hem),
  ];

  const mallar = [
    { id: "mitt", etikett: "Min vy", ikon: "konto" },
    ...ordnade.map((a) => ({ id: a.id, etikett: a.namn, ikon: a.ikon })),
  ];

  /**
   * En meny utan poster ritas inte. "Leverans & support" ar avdelningen som
   * finns i foretaget men annu inte i navet, och en rubrik utan innehall under
   * sig ar samma tomma lofte som en dodlank.
   */
  const menyer: NavMeny[] = [];
  for (const mall of mallar) {
    const poster = fack.get(mall.id);
    if (poster?.length) menyer.push({ ...mall, poster });
  }

  return { snabb, menyer };
}
