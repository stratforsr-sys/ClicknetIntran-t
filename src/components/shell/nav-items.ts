import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  ikon: string;
  raknare?: number;
};

/**
 * Sidopanelen visar bara moduler som faktiskt ar byggda. Dodlankar med
 * "kommer snart" ar samre an en kort meny — de larr anvandaren att menyn ljuger.
 * Listan vaxer nar varje modul levereras.
 */
export function navFor(user: CurrentUser | null, stamplingPa: boolean): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Hem", ikon: "hem" }];

  // Rutiner ligger overst efter Hem: det ar den vy alla anstallda har arende
  // till, till skillnad fran personal- och adminvyerna nedanfor.
  if (user?.employee) {
    // Nyheter fore rutiner: det ar det som andras oftast, och den som inte
    // hittar dit last aldrig beskedet.
    items.push({ href: "/nyheter", label: "Nyheter", ikon: "logg" });
    items.push({ href: "/rutiner", label: "Rutiner", ikon: "rutiner" });
    items.push({ href: "/utbildning", label: "Utbildning", ikon: "utbildning" });
    // Arenden galler alla: den anstallda ser sina egna, chefen ser inkorgen.
    items.push({ href: "/arenden", label: "Ärenden", ikon: "meny" });
    // K12: posten dyker upp forst nar modulen slas pa. En meny som pekar pa en
    // funktion som inte far anvandas ar samre an ingen post alls.
    if (stamplingPa) items.push({ href: "/tid", label: "Tid", ikon: "tid" });
    // E7 galler alla och kraver inte stampling: en semesteransokan hanger inte
    // pa om K12 ar avgjord. Bara paminnelserna om oregistrerad franvaro gor
    // det, och de hanteras i nattjobbet.
    items.push({ href: "/franvaro", label: "Frånvaro", ikon: "klocka" });

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
    items.push({ href: "/provision", label: "Provision", ikon: "kontroll" });
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
    items.push({ href: "/order", label: "Order", ikon: "kontroll" });
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
    items.push({ href: "/kv", label: "K&V", ikon: "kontroll" });
  }

  // Loneunderlaget ar ledningens och ekonomins (AC-2.13). Teamledaren har
  // avvikelsevyn, inte den har. Posten foljer M2: utan stampling finns inget
  // underlag att rapportera.
  if (stamplingPa && hasRole(user, "sales_manager", "ceo", "finance", "admin")) {
    items.push({ href: "/tid/lonerapport", label: "Lönerapport", ikon: "klocka" });
  }

  // K26/E15.1: lonekostnad ar en EGEN behorighet, inte en roll. Posten dyker
  // upp for den som har `payroll_cost_viewer` och for ingen annan — ekonomi
  // utan den ser den inte, och saljchefen ser den inte heller om hen inte
  // fatt den tilldelad. Kretsen som ser vad folk KOSTAR ar mindre an den som
  // skoter loner.
  if (user?.permissions.includes("payroll_cost_viewer")) {
    items.push({ href: "/lonekostnad", label: "Lönekostnad", ikon: "kontroll" });
  }

  if (canManageEmployees(user) || hasRole(user, "ceo", "team_lead")) {
    items.push({ href: "/personal", label: "Personal", ikon: "personal" });
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
    items.push({ href: "/rekrytering", label: "Rekrytering", ikon: "personal" });
  }

  /**
   * E9.1. Posten galler tva olika saker beroende pa vem som ser den, och det
   * ar avsiktligt att den finns for bada.
   *
   * Den som hanterar avtal ser mallarna och alla avtal. Alla andra ser sina
   * EGNA utfardade avtal, och att kunna lasa sitt eget anstallningsavtal utan
   * att be nagon leta upp det ar hela nyttan for dem som inte ar chefer.
   * RLS i 0028 avgor skillnaden.
   */
  if (user?.employee) {
    items.push({
      href: "/avtal",
      label: hasRole(user, "sales_manager", "ceo", "admin") ? "Avtal" : "Mitt avtal",
      ikon: "rutiner",
    });
  }
  if (hasRole(user, "sales_manager", "ceo", "admin")) {
    items.push({ href: "/logg", label: "Händelselogg", ikon: "logg" });
    // E6.5. Samma krets som handelseloggen. Teamledaren star utanfor: adoption
    // ar en fraga om navet, inte om hennes team, och en siffra per team hade
    // varit ett steg mot den per-person-uppfoljning 0029 ar byggd for att inte
    // gora mojlig.
    items.push({ href: "/adoption", label: "Adoption", ikon: "kontroll" });
  }

  /**
   * E0.6. Posten star sist och galler ALLA som har en anstalldrad.
   *
   * Det ar avsiktligt att saljaren ser den. En felrapportering som bara
   * cheferna hittar till rapporterar bara de fel cheferna sjalva ramlar pa,
   * och X7-piloten gar ut pa tre personer som inte ar chefer. Sidan visar
   * olika saker beroende pa vem som oppnar den — RLS avgor — men vagen dit
   * ar densamma for alla.
   */
  if (user?.employee) {
    items.push({
      href: "/fel",
      label: hasRole(user, "sales_manager", "ceo", "admin") ? "Fel" : "Rapportera fel",
      ikon: "varning",
    });
  }
  if (hasRole(user, "admin")) {
    items.push({ href: "/design", label: "Designsystem", ikon: "design" });
  }

  return items;
}
