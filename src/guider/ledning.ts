import type { Guide } from "./typer.ts";

/**
 * Guiderna för de vyer som inte alla har: personal, löneunderlag, kostnad,
 * avvikelser och rekrytering.
 *
 * ===========================================================================
 * DE HÄR TURERNA HANDLAR MER OM ANSVAR ÄN OM KNAPPAR.
 *
 * En säljare som inte hittar orderformuläret upptäcker det direkt. En chef som
 * inte vet att en attesterad löneperiod är låst, eller att avvikelsevyn skriver
 * en rad i händelseloggen varje gång den öppnas, upptäcker det aldrig — och det
 * är just de sakerna som får konsekvenser för någon annan.
 *
 * Därför är stegen här tyngre på VAD SOM GÄLLER och lättare på var saker
 * ligger. Det motsatta hade varit en rundtur för någon som redan hittar.
 * ===========================================================================
 */

export const PERSONAL: Guide = {
  slug: "personal-och-anstallning",
  titel: "Personal och anställning",
  beskrivning: "Registret, vad som händer när någon läggs upp, och de kvarglömda kontona.",
  version: 1,
  minuter: 4,
  roller: ["sales_manager", "ceo", "admin"],
  modul: "/personal",
  steg: [
    {
      rubrik: "Personal",
      text: "Fyra minuter om registret och om det som sätts igång när du lägger upp någon.",
      handling: "vidare",
      vag: "/personal",
    },
    {
      ankare: "personal.rubrik",
      rubrik: "Att lägga upp någon gör flera saker",
      text:
        "Konto, roll och behörighet skapas i ett steg. Målgruppens rutiner och kurser tilldelas " +
        "automatiskt, och en checklista faller ut med det som måste göras för hand — dator, " +
        "passerkort, avtal.",
      handling: "vidare",
    },
    {
      ankare: "personal.lista",
      rubrik: "Status är inte samma sak som roll",
      text:
        "Onboarding, Aktiv och Avslutad säger var i anställningen personen är. Rollen säger vad " +
        "hon får göra. Den som slutar ska avslutas här — annars ligger kontot kvar och fungerar.",
      handling: "vidare",
    },
    {
      rubrik: "Kvarglömda konton",
      text:
        "Ett konto som inte använts på 45 dagar flaggas överst på den här sidan. Det finns ingen " +
        "katalogtjänst som märker det åt er, så den raden är enda varningen ni får.",
      handling: "vidare",
    },
  ],
};

export const LONERAPPORT: Guide = {
  slug: "lonerapport",
  titel: "Lönerapport",
  beskrivning: "Underlaget per period, vad som låser det och vad navet inte gör.",
  version: 1,
  minuter: 3,
  roller: ["finance", "sales_manager", "ceo", "admin"],
  modul: "/tid/lonerapport",
  steg: [
    {
      rubrik: "Lönerapport",
      text: "Tre minuter om vad underlaget är — och vad det inte är.",
      handling: "vidare",
      vag: "/tid/lonerapport",
    },
    {
      ankare: "lonerapport.rubrik",
      rubrik: "Tid, inte pengar",
      text:
        "Navet räknar ingen lön och innehåller inga belopp här. Rapporten redovisar arbetad tid, " +
        "justeringar och antal avvikelser per person. Beloppen sätts i lönesystemet.",
      handling: "vidare",
    },
    {
      ankare: "lonerapport.perioder",
      rubrik: "Skapa perioden efter månadsskiftet",
      text:
        "Underlaget skrivs ur journalen, och journalen skrivs av nattjobbet. Skapar du perioden " +
        "innan natten gått är den tom — vänta tills månaden är slut och jobbet kört.",
      handling: "vidare",
    },
    {
      rubrik: "Attesterad är låst",
      text:
        "En attesterad period går inte att skriva om. Och den går inte att attestera så länge " +
        "avvikelser står öppna — det som ingen tittat på ska inte tyst följa med in i ett underlag.",
      handling: "vidare",
    },
  ],
};

export const LONEKOSTNAD: Guide = {
  slug: "lonekostnad",
  titel: "Lönekostnad",
  beskrivning: "Vad en säljare kostar, och varför siffran inte är ett löneunderlag.",
  version: 1,
  minuter: 3,
  roller: [],
  /**
   * Kretsen som ser vad folk KOSTAR är mindre än den som sköter löner, och den
   * följer inte av rollen — behörigheten delas ut per person under Personal.
   * Se K26/E15.1 och `PERMISSIONS` i roles.ts.
   */
  behorighet: "payroll_cost_viewer",
  modul: "/lonekostnad",
  steg: [
    {
      rubrik: "Lönekostnad",
      text:
        "Den här vyn är stängd för nästan alla — den delas ut som en egen behörighet, inte med " +
        "en roll. Tre minuter om vad siffrorna betyder.",
      handling: "vidare",
      vag: "/lonekostnad",
    },
    {
      ankare: "lonekostnad.rubrik",
      rubrik: "En uppskattning för beslut",
      text:
        "Vad en säljare kostar, och hur mycket hon behöver sälja för att bära sin egen kostnad. " +
        "Det är underlag för ett beslut — inte ett löneunderlag, och inte något att lämna vidare " +
        "som en exakt siffra.",
      handling: "vidare",
    },
    {
      ankare: "lonekostnad.period",
      rubrik: "Frånvaron kommer ur löneunderlaget",
      text:
        "Perioden du väljer styr allt. Frånvaron hämtas ur löneunderlaget för just den perioden, " +
        "så en period utan skrivet underlag ger en kostnad utan frånvaro — alltså för hög.",
      handling: "vidare",
    },
    {
      rubrik: "Behandla den som personuppgift",
      text:
        "Raderna säger vad namngivna personer kostar. Att du ser dem betyder inte att de får " +
        "delas vidare — kretsen är liten med flit.",
      handling: "vidare",
    },
  ],
};

export const AVVIKELSER: Guide = {
  slug: "avvikelser",
  titel: "Avvikelser",
  beskrivning: "Rasterna som inte följde schemat — och vad de inte får användas till.",
  version: 1,
  minuter: 3,
  roller: ["sales_manager", "ceo", "admin", "team_lead"],
  modul: "/tid/avvikelser",
  steg: [
    {
      rubrik: "Avvikelser",
      text: "Tre minuter, och det viktigaste är inte hur listan fungerar utan vad den inte är till för.",
      handling: "vidare",
      vag: "/tid/avvikelser",
    },
    {
      ankare: "avvikelser.regeln",
      rubrik: "En arbetsmiljösignal, inget annat",
      text:
        "Utebliven rast följs upp som en fråga om arbetsbelastning. Avvikelser används inte som " +
        "grund för varning, lönesättning eller uppsägning, och de når varken provisionen eller " +
        "lönekostnadsvyn.",
      handling: "vidare",
    },
    {
      ankare: "avvikelser.rubrik",
      rubrik: "Varje öppning loggas",
      text:
        "Sidan skriver en rad i händelseloggen varje gång den öppnas. Den visar inga stämplingar " +
        "och ingen rastlängd i övrigt — bara det som avvek.",
      handling: "vidare",
    },
    {
      rubrik: "Att avsluta är att kvittera",
      text:
        "Knappen betyder att avvikelsen är omhändertagen, ingenting mer. Ingen automatik hänger i " +
        "den. Men löneperioden går inte att attestera medan avvikelser står öppna.",
      handling: "vidare",
    },
  ],
};

export const REKRYTERING: Guide = {
  slug: "rekrytering",
  titel: "Rekrytering",
  beskrivning: "Kandidater, stegen de står i, och den som blivit liggande.",
  version: 1,
  minuter: 3,
  roller: ["sales_manager", "ceo", "admin"],
  modul: "/rekrytering",
  steg: [
    {
      rubrik: "Rekrytering",
      text: "Tre minuter om processen och om varför listan är sorterad som den är.",
      handling: "vidare",
      vag: "/rekrytering",
    },
    {
      ankare: "rekrytering.rubrik",
      rubrik: "Sorterad efter liggetid",
      text:
        "Överst står inte den nyaste kandidaten utan den som stått stilla längst. En process som " +
        "ingen rört på två veckor är det som kostar er kandidaten — inte den ni pratade med i går.",
      handling: "vidare",
    },
    {
      ankare: "rekrytering.lista",
      rubrik: "Kandidaten följer med hela vägen",
      text:
        "Blir hen anställd går uppgifterna vidare till Personal och anställningen skapas därifrån. " +
        "Du behöver inte skriva in namnet en andra gång.",
      handling: "vidare",
    },
    {
      rubrik: "Även avslag hör hemma här",
      text:
        "En kandidat som fått avslag stannar i registret. Det är både en hjälp nästa gång ni " +
        "rekryterar och ett svar på frågan varför någon inte gick vidare.",
      handling: "vidare",
    },
  ],
};
