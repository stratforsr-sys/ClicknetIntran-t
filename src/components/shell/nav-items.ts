import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, canReadAllEmployees, hasRole } from "@/lib/auth";
import { stampelfri } from "@/lib/stampelfri";
import { AVDELNINGAR, avdelningFor, type AvdelningId } from "@/lib/avdelningar";

export type NavItem = {
  href: string;
  label: string;
  ikon: string;
  raknare?: number;
};

/**
 * Ett fack inuti en vy.
 *
 * I chefs- och adminvyn ÄR grupperna avdelningarna, och `id` är då en
 * `AvdelningId`. I "Min vy" är de i stället teman — mitt arbete, min
 * anställning — eftersom en avdelning inte betyder något när alla poster
 * handlar om en själv.
 */
export type NavGrupp = {
  id: string;
  etikett: string;
  ikon: string;
  poster: NavItem[];
};

export type VyId = "min" | "chef" | "admin";

export type NavVy = {
  id: VyId;
  etikett: string;
  ikon: string;
  grupper: NavGrupp[];
  /** Gruppen som står vald när vyn öppnas. `null` betyder "Alla". */
  start: string | null;
};

export type Navigering = {
  /** Posterna som alltid står framme i panelen. */
  snabb: NavItem[];
  /** Vyerna, i den ordning de ska ritas. Tomma vyer finns inte med. */
  vyer: NavVy[];
};

/**
 * Sidopanelen visar bara moduler som faktiskt ar byggda. Dodlankar med
 * "kommer snart" ar samre an en kort meny — de larr anvandaren att menyn ljuger.
 * Listan vaxer nar varje modul levereras.
 *
 * ===========================================================================
 * MENYN ÄR TVÅ LED, INTE EN LISTA (2026-09-09).
 *
 * Listan hade vuxit till arton poster. Alla var behörighetsprövade och alla
 * hörde hemma i navet, men arton likadana rader i en spalt är inte en meny —
 * det är en innehållsförteckning man läser varje gång i stället för att sikta.
 *
 * Nu står bara det man gör VARJE DAG framme. Resten ligger i vyer:
 *
 * - **Min vy** — sidorna som handlar om mig. Alla anställda har den.
 * - **Chefsvy** — sidorna som handlar om andra eller om bolaget, grupperade
 *   per avdelning.
 * - **Adminvy** — navet självt: loggen, adoptionen, felen, designsystemet.
 *
 * TVÅ REGLER BÄR HELA FILEN, OCH BÅDA ÄR LÄTTA ATT BRYTA MOT AV MISSTAG:
 *
 * 1. **EN POST HAMNAR PÅ EXAKT ETT STÄLLE.** Flera sidor är två vyer i en —
 *    `/order` är säljarens egna order och säljchefens godkännandekö, `/avtal`
 *    är mitt anställningsavtal och chefens mallar. Sådana poster placeras
 *    efter vem som tittar: den som ser sidan som sin egen får den i Min vy,
 *    den som ser den som chefens får den i Chefsvyn. Läggs den i båda står
 *    samma länk två gånger i samma meny, och då är vi tillbaka i listan.
 *
 * 2. **MENYN DELAR INTE UT NÅGOT.** Varje villkor nedan är oförändrat från den
 *    platta listan. Åtkomsten avgörs av roller, behörigheter och RLS — den här
 *    filen avgör bara var posten hamnar. En post som flyttas mellan vyer får
 *    aldrig byta villkor på vägen.
 *
 * En vy som inte fick några poster ritas inte alls. Det är samma regel som
 * gällde de enskilda posterna, och den är viktigare här: en tom "Chefsvy" är
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
   * Posterna samlas platt och sorteras in på slutet. Nyckeln är `vy/grupp`.
   *
   * Fördelen mot att bygga vyerna direkt är att ett fack som aldrig fick något
   * inte behöver städas bort efteråt — det uppstod aldrig.
   */
  const fack = new Map<string, NavItem[]>();
  const lagg = (vy: VyId, grupp: string, post: NavItem) => {
    const nyckel = `${vy}/${grupp}`;
    const lista = fack.get(nyckel);
    if (lista) lista.push(post);
    else fack.set(nyckel, [post]);
  };

  /**
   * Vem som ser säljsidorna som CHEFENS och vem som ser dem som SINA EGNA.
   *
   * Samma sida, samma RLS — bara olika fack. Säljaren och teamledaren ser sin
   * egen provision och sina egna order, och för dem hör posterna hemma i
   * Min vy. Säljchefen, VD och ekonomi ser allas, godkänner och makulerar.
   */
  const serAllasForsaljning = hasRole(user, "sales_manager", "ceo", "finance");

  /**
   * Coachningen följer sidans EGEN fråga: `farCoacha()` i coachning-server.ts
   * släpper in den som läser hela registret plus teamledaren, och skickar alla
   * andra till sitt eget kort. Villkoret står utskrivet här i stället för
   * importerat, för att den här filen inte ska dra in serverkoden.
   */
  const coacharAndra = canReadAllEmployees(user) || hasRole(user, "team_lead");

  /**
   * Navets egna sidor — loggen, adoptionen, felinkorgen — hör hemma i adminvyn
   * när personen har en, och i chefsvyns systemgrupp annars.
   *
   * Utan det ledet står de på två ställen för den som är både säljchef och
   * administratör, vilket är precis vad regel 1 ovan förbjuder.
   */
  const harAdminvy = hasRole(user, "admin");
  const systemvy: VyId = harAdminvy ? "admin" : "chef";

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
     * EGEN post i ekonomigruppen och paverkas inte.
     *
     * Posten star bland snabbposterna och inte i en vy: stamplingen ar dagens
     * forsta och sista handling, och den ska inte ligga bakom ett klick till.
     */
    const stamplarSjalv = stamplingPa && !stampelfri(user.roles);
    const harKoPaTid = stamplingPa && (canManageEmployees(user) || hasRole(user, "ceo"));
    if (stamplarSjalv || harKoPaTid) snabb.push({ href: "/tid", label: "Tid", ikon: "tid" });

    // Arenden galler alla: den anstallda ser sina egna, chefen ser inkorgen.
    // Bada far den i sitt eget fack — det ar samma inkorg, och chefens arenden
    // ar hens egna.
    lagg("min", "arbete", { href: "/arenden", label: "Ärenden", ikon: "meny" });

    /**
     * Coachningen star bredvid utbildningen och inte under den, for att de
     * svarar pa olika fragor: utbildningen ar INNEHALLET, coachningen ar
     * uppfoljningen av personer.
     *
     * Posten galler ALLA och visar olika saker beroende pa vem som oppnar den.
     * Chefen far lagvyn och hittar den under Personal; alla andra skickas till
     * sitt eget kort, och for dem ar det en post om dem sjalva.
     */
    if (coacharAndra) lagg("chef", "personal", { href: "/coachning", label: "Coachning", ikon: "kontroll" });
    else lagg("min", "arbete", { href: "/coachning", label: "Min coachning", ikon: "kontroll" });

    // E7 galler alla och kraver inte stampling: en semesteransokan hanger inte
    // pa om K12 ar avgjord. Bara paminnelserna om oregistrerad franvaro gor
    // det, och de hanteras i nattjobbet.
    lagg("min", "anstallning", { href: "/franvaro", label: "Frånvaro", ikon: "klocka" });

    /**
     * E13. Posten galler alla, och visar olika saker beroende pa vem som
     * oppnar den — RLS i 0031 avgor. Saljaren ser sin EGEN intjanade
     * provision; ekonomi och VD ser allas och bokfor dem.
     *
     * Skillnaden mot lonekostnaden ar avsiktlig. Den raden ar bolagets kalkyl
     * PA en person och stangd for alla utom `payroll_cost_viewer`. Den har ar
     * personens egen intjaning, och att kunna se vad man arbetat ihop utan att
     * be nagon leta upp det ar hela nyttan.
     */
    if (serAllasForsaljning) {
      lagg("chef", "forsaljning", { href: "/provision", label: "Provision", ikon: "kontroll" });
    } else {
      lagg("min", "anstallning", { href: "/provision", label: "Min provision", ikon: "kontroll" });
    }
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
    const post: NavItem = { href: "/order", label: "Order", ikon: "kontroll" };
    if (serAllasForsaljning) lagg("chef", "forsaljning", post);
    else lagg("min", "arbete", post);
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
    const post: NavItem = { href: "/kv", label: "K&V", ikon: "kontroll" };
    if (serAllasForsaljning) lagg("chef", "forsaljning", post);
    else lagg("min", "arbete", post);
  }

  // Loneunderlaget ar ledningens och ekonomins (AC-2.13). Teamledaren har
  // avvikelsevyn, inte den har. Posten foljer M2: utan stampling finns inget
  // underlag att rapportera.
  if (stamplingPa && hasRole(user, "sales_manager", "ceo", "finance", "admin")) {
    lagg("chef", "ekonomi", { href: "/tid/lonerapport", label: "Lönerapport", ikon: "klocka" });
  }

  // K26/E15.1: lonekostnad ar en EGEN behorighet, inte en roll. Posten dyker
  // upp for den som har `payroll_cost_viewer` och for ingen annan — ekonomi
  // utan den ser den inte, och saljchefen ser den inte heller om hen inte
  // fatt den tilldelad. Kretsen som ser vad folk KOSTAR ar mindre an den som
  // skoter loner.
  if (user?.permissions.includes("payroll_cost_viewer")) {
    lagg("chef", "ekonomi", { href: "/lonekostnad", label: "Lönekostnad", ikon: "kontroll" });
  }

  if (canManageEmployees(user) || hasRole(user, "ceo", "team_lead")) {
    lagg("chef", "personal", { href: "/personal", label: "Personal", ikon: "personal" });
  }

  /**
   * E10. Q71: FLERA PERSONER REKRYTERAR, och vilka det ar foljer inte av
   * rollen. Ledningen far posten pa rollen sa att modulen fungerar direkt;
   * alla andra far den tilldelad som `recruiter` under Personal.
   *
   * Skillnaden mot K26 ar avsiktlig. Lonekostnad kraver behorigheten AV ALLA,
   * och det ar en av sakerna som fortfarande maste goras for hand innan den
   * vyn visar nagot. Rekrytering ska inte krava samma steg for att ens starta.
   *
   * DEN HAR POSTEN AR SKALET ATT VYERNA RITAS EFTER INNEHALL OCH INTE EFTER
   * ROLL. En saljare med `recruiter` ar ingen chef, men hen har en chefssida —
   * och hade vyn krävt en chefsroll hade lanken forsvunnit for just den
   * person modulen delades ut till.
   */
  if (hasRole(user, "sales_manager", "ceo", "admin") || user?.permissions.includes("recruiter")) {
    lagg("chef", "personal", { href: "/rekrytering", label: "Rekrytering", ikon: "personal" });
  }

  /**
   * E9.1. Posten galler tva olika saker beroende pa vem som ser den, och det
   * ar avsiktligt att den finns for bada.
   *
   * Den som hanterar avtal ser mallarna och alla avtal, och hittar dem under
   * Personal. Alla andra ser sina EGNA utfardade avtal, och det ar en post om
   * den egna anstallningen. Att kunna lasa sitt eget anstallningsavtal utan
   * att be nagon leta upp det ar hela nyttan for dem som inte ar chefer.
   * RLS i 0028 avgor skillnaden.
   */
  if (user?.employee) {
    if (hasRole(user, "sales_manager", "ceo", "admin")) {
      lagg("chef", "personal", { href: "/avtal", label: "Avtal", ikon: "rutiner" });
    } else {
      lagg("min", "anstallning", { href: "/avtal", label: "Mitt avtal", ikon: "rutiner" });
    }
  }

  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    lagg(systemvy, "system", { href: "/logg", label: "Händelselogg", ikon: "logg" });
    // E6.5. Samma krets som handelseloggen. Teamledaren star utanfor: adoption
    // ar en fraga om navet, inte om hennes team, och en siffra per team hade
    // varit ett steg mot den per-person-uppfoljning 0029 ar byggd for att inte
    // gora mojlig.
    lagg(systemvy, "system", { href: "/adoption", label: "Adoption", ikon: "kontroll" });
  }

  /**
   * E0.6. Posten galler ALLA som har en anstalldrad.
   *
   * Det ar avsiktligt att saljaren ser den. En felrapportering som bara
   * cheferna hittar till rapporterar bara de fel cheferna sjalva ramlar pa,
   * och X7-piloten gar ut pa tre personer som inte ar chefer. Sidan visar
   * olika saker beroende pa vem som oppnar den — RLS avgor — men vagen dit
   * ar densamma for alla.
   *
   * Facket skiljer sig dock: for den som far INKORGEN ar det en systemsida,
   * for alla andra en knapp man trycker pa nar nagot gatt sonder.
   */
  if (user?.employee) {
    if (hasRole(user, "sales_manager", "ceo", "admin")) {
      lagg(systemvy, "system", { href: "/fel", label: "Fel", ikon: "varning" });
    } else {
      lagg("min", "navet", { href: "/fel", label: "Rapportera fel", ikon: "varning" });
    }
  }

  if (hasRole(user, "admin")) {
    lagg("admin", "system", { href: "/design", label: "Designsystem", ikon: "design" });
  }

  /**
   * Min vys grupper är teman och inte avdelningar. Ordningen är den man frågar
   * i: vad ska jag göra, vad gäller min anställning, och sist navet självt.
   */
  const MINA_GRUPPER = [
    { id: "arbete", etikett: "Mitt arbete", ikon: "kontroll" },
    { id: "anstallning", etikett: "Min anställning", ikon: "rutiner" },
    { id: "navet", etikett: "Navet", ikon: "varning" },
  ];

  /** Chefs- och adminvyns grupper ÄR avdelningarna, i avdelningsordning. */
  const avdelningsgrupper = AVDELNINGAR.map((a) => ({ id: a.id, etikett: a.namn, ikon: a.ikon }));

  const hem = avdelningFor(user);

  const vyer = [
    bygg("min", "Min vy", "konto", MINA_GRUPPER, fack, null),
    bygg("chef", "Chefsvy", "personal", avdelningsgrupper, fack, hem),
    bygg("admin", "Adminvy", "installningar", avdelningsgrupper, fack, null),
  ].filter((vy): vy is NavVy => vy !== null);

  return { snabb, vyer };
}

/**
 * Sätter ihop en vy av de fack som faktiskt fick något.
 *
 * Svarar `null` när vyn blev tom. Det är den regel som gör att en säljare
 * aldrig ser en "Chefsvy" och en teamledare inte ser en "Adminvy" — utan att
 * någon behöver räkna upp roller en andra gång längre ner i filen.
 */
function bygg(
  id: VyId,
  etikett: string,
  ikon: string,
  mallar: { id: string; etikett: string; ikon: string }[],
  fack: Map<string, NavItem[]>,
  onskadStart: AvdelningId | null,
): NavVy | null {
  const grupper: NavGrupp[] = [];
  for (const mall of mallar) {
    const poster = fack.get(`${id}/${mall.id}`);
    // En grupp utan poster ritas inte. "Leverans & support" är avdelningen som
    // finns i företaget men ännu inte i navet, och en rubrik utan innehåll
    // under sig är samma tomma löfte som en dödlänk.
    if (poster?.length) grupper.push({ ...mall, poster });
  }
  if (grupper.length === 0) return null;

  /**
   * Den egna avdelningen står vald när vyn öppnas — men bara om den fick några
   * poster. En förvald flik som är tom är sämre än att börja på "Alla".
   */
  const start = grupper.some((g) => g.id === onskadStart) ? onskadStart : null;
  return { id, etikett, ikon, grupper, start };
}
