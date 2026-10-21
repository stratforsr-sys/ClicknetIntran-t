import type { Guide } from "./typer.ts";

/**
 * Systemguiderna för Nav 2.0 (beställaren 2026-10-20, svar 9: "Skrivas om för
 * nav 2.0").
 *
 * ===========================================================================
 * ANKARET ÄR EN CSS-VÄLJARE I NAV 2.0, INTE ETT data-guide-ATTRIBUT
 *
 * Nav 2.0 är utkastets HTML (`src/nav2/utkast.html`), och dess utseende ändras
 * inte (beställaren 2026-10-19). Turerna pekar därför på det som redan står i
 * sidan: menyraderna (`data-rlsl`), vyernas kort och flikar. En lista med
 * kommatecken betyder "den första som syns", så att samma steg fungerar för
 * säljaren och chefen, som ser olika knappar. Hittas inget visas rutan mitt på
 * skärmen. `npm run test:guider` kontrollerar att varje väljare finns i
 * utkastet.
 *
 * `vag` är en adress som Nav 2.0 öppnar med `ndGa` (samma som i notiserna).
 * `modul` är vyn där turen startar av sig själv första gången den öppnas, som
 * förut. Alla turer ligger också under Utbildning → Biblioteket → Lär dig Nav.
 * ===========================================================================
 *
 * SLUGARNA ÄR DE GAMLA där momentet finns kvar, med versionen höjd och
 * `omtag: true`: alla gör om turerna i Nav 2.0, även den som gått igenom dem i
 * gamla Nav (beställaren 2026-10-21: "Det är viktigt"). Avvikelser (rasten) och
 * K&V har ingen tur: rasten är borttagen och K&V är dold tills vidare. Två
 * turer är nya, ur utkastets kurs "Kom igång med Nav": Dagens tre i Uppgifter
 * och Fråga Nav. De krävs som de andra.
 *
 * Fristen för en ny version räknas från natten den kom i bruk, inte från
 * startdatumet (`infort` i `personlage()`, bokfört av nattjobbet). Annars hade
 * alla som redan jobbar varit över fristen första natten efter bytet.
 */

const MENY = (etikett: string) => `.ritem[data-rlsl="${etikett}"]`;

export const KOM_IGANG_NAV2: Guide = {
  slug: "kom-igang-i-navet",
  titel: "Kom igång i Nav",
  beskrivning: "Var allt ligger, och vad du gör härifrån. Fyra minuter.",
  version: 2,
  omtag: true,
  minuter: 4,
  roller: [],
  vidForstaInloggningen: true,
  steg: [
    {
      rubrik: "Välkommen till Nav",
      text: "Fyra minuter, nio steg. Sen vet du var allt ligger. Du kan pausa när som helst och fortsätta på samma steg.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: "#inbox",
      rubrik: "Det som kräver dig",
      text: "Startsidan samlar beslut och uppgifter från hela Nav, med det som brådskar först. Det mesta gör du direkt härifrån.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: ".rls-sok, .cmdk-btn",
      rubrik: "Sök, gör eller fråga Nav",
      text: "Hitta rutiner, personer, kurser och dina ärenden, eller gör det vanligaste direkt. Tryck ⌘K var du än är i Nav.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: ".rls-bell, [data-bell]",
      rubrik: "Klockan säger till",
      text: "Nya rutiner att kvittera, kurser som väntar och svar i dina ärenden. Det olästa räknas här.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: MENY("Uppgifter"),
      rubrik: "Menyn",
      text: "Menyn visar bara det du har tillgång till. Siffran vid en rad är det som väntar där.",
      handling: "vidare",
      bara: "dator",
      vag: "/",
    },
    {
      ankare: "[data-rlsmer], .smp-mer",
      rubrik: "Resten bakom Mer",
      text: "På telefonen ligger det du använder mest i raden längst ner. Resten av Nav öppnar du med Mer.",
      handling: "vidare",
      bara: "mobil",
      vag: "/",
    },
    {
      ankare: MENY("Rutiner"),
      ankare_mobil: "[data-rlsmer], .smp-mer",
      rubrik: "Rutiner är det som gäller",
      text: "Här står arbetssätten du förväntas följa. Några ska kvitteras, och då säger klockan till.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: MENY("Utbildning"),
      ankare_mobil: "[data-rlsmer], .smp-mer",
      rubrik: "Här finns turerna",
      text: "Utbildning har kurserna. Under Biblioteket, Lär dig Nav, ligger den här turen och de andra, så att du kan göra om dem.",
      handling: "vidare",
      vag: "/",
    },
    {
      ankare: "#prfKnapp",
      rubrik: "Ditt namn är inställningarna",
      text: "Lösenord, utseende, notiser och dina uppgifter ligger bakom ditt namn. Där loggar du också ut.",
      handling: "vidare",
      vag: "/",
    },
    {
      rubrik: "Du är igång",
      text: "Resten lär du dig där du står: varje del av Nav har en kort tur som startar första gången du öppnar den.",
      handling: "vidare",
    },
  ],
};

export const UPPGIFTER_NAV2: Guide = {
  slug: "dagens-tre-i-uppgifter",
  titel: "Dagens tre i Uppgifter",
  beskrivning: "Skriv som du tänker, välj dagens tre och avsluta dagen.",
  version: 1,
  minuter: 2,
  roller: [],
  modul: "/uppgifter",
  steg: [
    {
      rubrik: "Uppgifter",
      text: "Två minuter om hur du planerar dagen.",
      handling: "vidare",
      vag: "/uppgifter",
    },
    {
      ankare: ".upg-huvud",
      rubrik: "Skriv som du tänker",
      text: "Skriv en uppgift som en mening, till exempel ”Ring Anna fredag 10”. Nav förstår dag och tid.",
      handling: "vidare",
      vag: "/uppgifter",
    },
    {
      ankare: ".upg-dag",
      rubrik: "Dagens tre",
      text: "Välj de tre saker som måste bli gjorda i dag. Resten ligger under, i den ordning de förfaller. Låt Nav föreslå om du vill.",
      handling: "vidare",
      vag: "/uppgifter",
    },
    {
      ankare: "#upgFlik-idag, [data-tab=\"idag\"]",
      rubrik: "Flikarna",
      text: "I dag, Kommande, det som väntar på andra och det du ska granska. Allt du har ligger under Alla mina.",
      handling: "vidare",
      vag: "/uppgifter",
    },
    {
      rubrik: "Avsluta dagen",
      text: "Sist på dagen trycker du Avsluta dagen och ger det som blev kvar en plats: en ny dag, någon gång eller struket. Du ser också vad du hann.",
      handling: "vidare",
    },
  ],
};

export const RUTINER_NAV2: Guide = {
  slug: "rutiner-och-kvittens",
  titel: "Hitta en rutin",
  beskrivning: "Var arbetssätten står, och vad en kvittens betyder.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  modul: "/rutiner",
  steg: [
    {
      rubrik: "Rutiner",
      text: "Arbetssätten du förväntas följa. Två minuter om hur du hittar i dem.",
      handling: "vidare",
      vag: "/rutiner",
    },
    {
      ankare: ".rtn-sok",
      rubrik: "Sök med dina egna ord",
      text: "Skriv vad du behöver, som ”sjukanmälan” eller ”kunden vill säga upp”. Tryck på snedstrecket så hamnar du här direkt.",
      handling: "vidare",
      vag: "/rutiner",
    },
    {
      ankare: ".rtn-huvud",
      rubrik: "Områden och Säljresan",
      text: "Rutinerna är ordnade efter område och efter var i säljet du är. Ny för dig visar det som tillkommit eller ändrats sedan du läste.",
      handling: "vidare",
      vag: "/rutiner",
    },
    {
      rubrik: "Kvittensen",
      text: "Vissa rutiner ska kvitteras. Du läser steg för steg och kvitterar sist. Kommer en ny version säger klockan till igen, eftersom kvittensen gäller den version du läste.",
      handling: "vidare",
    },
  ],
};

export const NYHETER_NAV2: Guide = {
  slug: "nyheter",
  titel: "Nyheter",
  beskrivning: "Besked från ledningen och det som är nytt i Nav.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  modul: "/nyheter",
  steg: [
    {
      rubrik: "Nyheter",
      text: "Två minuter om var beskeden kommer ifrån och varför din lista inte är samma som kollegans.",
      handling: "vidare",
      vag: "/nyheter",
    },
    {
      ankare: "[data-nhfilt]",
      rubrik: "Riktat till dig",
      text: "Ett inlägg kan riktas till en roll eller ett team, så du ser det som gäller dig. Filtrera på olästa eller det du ska kvittera.",
      handling: "vidare",
      vag: "/nyheter",
    },
    {
      rubrik: "Kvittera när det behövs",
      text: "Vissa inlägg ska kvitteras före ett datum. Då säger klockan till tills du gjort det. Nytt i Nav visar det som ändrats i Nav.",
      handling: "vidare",
    },
  ],
};

export const ARENDEN_NAV2: Guide = {
  slug: "arenden",
  titel: "Ärenden",
  beskrivning: "Frågor till ledningen som inte försvinner i en chatt.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  modul: "/arenden",
  steg: [
    {
      rubrik: "Ärenden",
      text: "Lön, utrustning, schema och arbetsmiljö: allt som annars sägs i förbifarten och glöms. Här finns frågan kvar, och svaret också.",
      handling: "vidare",
      vag: "/arenden",
    },
    {
      ankare: ".arskriv, .arlage",
      rubrik: "Skriv som du hade sagt det",
      text: "Välj vad det gäller, så vet Nav vem som svarar och hur snart. Slå på Konfidentiellt om det är känsligt, så ser bara säljchefen och VD det.",
      handling: "vidare",
      vag: "/arenden",
    },
    {
      rubrik: "Svarstiden räknas",
      text: "Varje ärende har en utlovad svarstid. Du ser hela dialogen och får en notis i klockan när någon svarar.",
      handling: "vidare",
    },
  ],
};

export const FRANVARO_NAV2: Guide = {
  slug: "franvaro",
  titel: "Ansök om ledighet",
  beskrivning: "Söka ledigt, sjukanmäla dig och se vad som är beslutat.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  modul: "/franvaro",
  steg: [
    {
      rubrik: "Frånvaro",
      text: "Två saker som ser lika ut men fungerar olika: ledighet söks i förväg, sjukdom anmäls samma dag.",
      handling: "vidare",
      vag: "/franvaro",
    },
    {
      ankare: ".frvalj, .frtavla",
      rubrik: "Vad gäller det?",
      text: "Välj vad det gäller, så visar Nav reglerna medan du fyller i. Är du sjuk ringer du din chef först och anmäler sedan här.",
      handling: "vidare",
      vag: "/franvaro",
    },
    {
      rubrik: "Beslutet kommer till dig",
      text: "En ansökan ligger hos chefen tills den är beslutad, och du får en notis när beslutet kommer. Godkänd ledighet syns i teamets planering.",
      handling: "vidare",
    },
  ],
};

export const STAMPLA_NAV2: Guide = {
  slug: "stampla-in-och-ut",
  titel: "Stämpla in och ut",
  beskrivning: "Knappen, dagens rader och vad som händer om du glömmer.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  krav: "stamplar",
  modul: "/tid",
  steg: [
    {
      rubrik: "Tid",
      text: "Två minuter om stämplingen och om vad som händer när du glömmer.",
      handling: "vidare",
      vag: "/tid",
    },
    {
      ankare: ".tistamp, [data-act=\"in\"], [data-act=\"ut\"]",
      rubrik: "Tiden sätts när du trycker",
      text: "Stämpla in när du börjar och ut när du slutar. Tiden som gäller är den när du trycker.",
      handling: "vidare",
      vag: "/tid",
    },
    {
      ankare: "[data-tilagg], [data-tiratt]",
      rubrik: "En rad ändras med en rättelse",
      text: "En stämpling går inte att ändra eller ta bort. Blev det fel begär du en rättelse, och chefen beslutar om den.",
      handling: "vidare",
      vag: "/tid",
    },
    {
      rubrik: "Glömd utstämpling",
      text: "Glömmer du stämpla ut stänger Nav dagen enligt ditt schema och frågar dig om tiden stämmer. Svara när du ser det, så blir lönerapporten rätt.",
      handling: "vidare",
    },
  ],
};

export const AVTAL_NAV2: Guide = {
  slug: "avtal",
  titel: "Mitt avtal",
  beskrivning: "Ditt anställningsavtal, utan att fråga någon.",
  version: 2,
  omtag: true,
  minuter: 1,
  roller: [],
  modul: "/avtal",
  steg: [
    {
      rubrik: "Avtal",
      text: "Ditt anställningsavtal och dina tilläggsavtal, som PDF. Du öppnar och läser dem direkt.",
      handling: "vidare",
      vag: "/avtal",
    },
    {
      rubrik: "Vem ser vad",
      text: "Du ser dina egna avtal och din egen lön. Säljchef, VD och administratör laddar upp avtalen och ser allas.",
      handling: "vidare",
    },
  ],
};

export const FEL_NAV2: Guide = {
  slug: "rapportera-fel",
  titel: "Rapportera fel",
  beskrivning: "Vad du gör när Nav gör fel, och varför det är värt en halv minut.",
  version: 2,
  omtag: true,
  minuter: 1,
  roller: [],
  modul: "/fel",
  steg: [
    {
      ankare: "[data-felny]",
      rubrik: "Skriv vad du gjorde",
      text: "Vilken sida, vad du tryckte på och vad som hände i stället. Nav fyller själv i vem du är och var du var.",
      handling: "vidare",
      vag: "/fel",
    },
    {
      rubrik: "Du ser vad som händer med den",
      text: "Din rapport ligger kvar tills den är lagad, och du får besked. Rapportera även om du tror att någon hunnit före: ett fel som träffat fler räknas ihop.",
      handling: "vidare",
    },
  ],
};

export const ORDER_NAV2: Guide = {
  slug: "registrera-order",
  titel: "Lägg en order",
  beskrivning: "Ny order, vad som räknas och hur ordern tar sig vidare.",
  version: 2,
  omtag: true,
  minuter: 3,
  roller: ["salesperson", "sales_manager", "ceo", "finance"],
  modul: "/order",
  steg: [
    {
      rubrik: "Order",
      text: "Tre minuter om formuläret, siffrorna och vad som händer när du skickat in.",
      handling: "vidare",
      vag: "/order",
    },
    {
      ankare: "[data-ordny]",
      rubrik: "Ny order",
      text: "Välj paket och signeringsdatum. Provisionen hämtas ur paketmatrisen för signeringsdatumet, och koppla säljsamtalet innan du skickar in.",
      handling: "vidare",
      vag: "/order",
    },
    {
      ankare: ".ordkpi",
      rubrik: "Netto, inte brutto",
      text: "Siffrorna är godkända order minus det som makulerats. En makulering dras den månad den görs, och en stängd månad skrivs aldrig om.",
      handling: "vidare",
      vag: "/order",
    },
    {
      rubrik: "Inskickat är inte godkänt",
      text: "Ordern går till säljchefen och räknas i provisionen först när den är godkänd. Du får en notis när den är avgjord.",
      handling: "vidare",
    },
  ],
};

export const PROVISION_NAV2: Guide = {
  slug: "las-din-provision",
  titel: "Din provision",
  beskrivning: "Månadens siffra, dagens order, takten och vägen till nästa bonus.",
  version: 3,
  omtag: true,
  minuter: 3,
  roller: ["salesperson", "sales_manager", "ceo", "finance"],
  modul: "/provision",
  steg: [
    {
      rubrik: "Provision",
      text: "Tre minuter om vad du tjänat, vad du taktar och vad som krävs för nästa bonus.",
      handling: "vidare",
      vag: "/provision",
    },
    {
      ankare: ".pv-panel",
      rubrik: "Månadens siffra",
      text: "Det du arbetat ihop den här månaden. Det är intjänat, inte utbetalt. En öppen månad räknas live, en fastställd står stilla.",
      handling: "vidare",
      vag: "/provision",
    },
    {
      ankare: ".pv-k, .pv-lag",
      rubrik: "I dag, takten och målet",
      text: "Dagens order, vad månaden landar på i samma takt räknat på arbetsdagar, och ditt mål.",
      handling: "vidare",
      vag: "/provision",
    },
    {
      ankare: "#pvRader, .pv-lag",
      rubrik: "Rad för rad",
      text: "Varje order, bonus och avdrag som bygger siffran. Stämmer något inte är det den här listan du pekar på i ett ärende.",
      handling: "vidare",
      vag: "/provision",
    },
  ],
};

export const PERSONAL_NAV2: Guide = {
  slug: "personal-och-anstallning",
  titel: "Anställda",
  beskrivning: "Det som kräver dig, och vad som händer när någon läggs upp.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: ["sales_manager", "ceo", "admin"],
  modul: "/personal",
  steg: [
    {
      ankare: ".aekr",
      rubrik: "Det som kräver dig",
      text: "Uppgifterna i onboarding och offboarding som väntar på dig, med det som passerat fristen först.",
      handling: "vidare",
      vag: "/personal",
    },
    {
      ankare: "[data-aeny]",
      rubrik: "Lägg upp anställd",
      text: "Konto, roll och checklista skapas i ett steg, och rutiner och kurser för rollen tilldelas. Den som slutar avslutas här, annars fungerar kontot kvar.",
      handling: "vidare",
      vag: "/personal",
    },
  ],
};

export const REKRYTERING_NAV2: Guide = {
  slug: "rekrytering",
  titel: "Rekrytering",
  beskrivning: "Kandidaterna, intervjuerna och det som väntar på dig.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: ["sales_manager", "ceo", "admin"],
  modul: "/rekrytering",
  steg: [
    {
      rubrik: "Rekrytering",
      text: "Två minuter om att göra-listan och om hur en kandidat blir anställd.",
      handling: "vidare",
      vag: "/rekrytering",
    },
    {
      ankare: "#main .card, main .card",
      rubrik: "Att göra först",
      text: "Överst står det som väntar på dig i dag, som ett erbjudande som ska besvaras eller en intervju att bedöma.",
      handling: "vidare",
      vag: "/rekrytering",
    },
    {
      rubrik: "Kandidaten följer med",
      text: "Blir en kandidat anställd går uppgifterna vidare till Anställda. Den som fått avslag finns kvar i tolv månader, sedan gallras uppgifterna.",
      handling: "vidare",
    },
  ],
};

export const LONERAPPORT_NAV2: Guide = {
  slug: "lonerapport",
  titel: "Lönerapport",
  beskrivning: "Underlaget per period, och vad som låser det.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: ["finance", "sales_manager", "ceo", "admin"],
  steg: [
    {
      ankare: "[data-titab=\"lon\"]",
      rubrik: "Lönerapporten",
      text: "Under Tid, Lönerapport. Underlaget är arbetad tid, justeringar och frånvaro per person, inga belopp. Beloppen sätts i lönesystemet.",
      handling: "vidare",
      vag: "/tid/lonerapport",
    },
    {
      ankare: "[data-ndtiper]",
      rubrik: "Perioden",
      text: "Välj period. Den pågående månaden visas medan den räknas, och underlaget skrivs när perioden är slut.",
      handling: "vidare",
      vag: "/tid/lonerapport",
    },
    {
      rubrik: "Granska, attestera, skicka",
      text: "När perioden är slut granskar och attesterar du underlaget och skickar det till lön. Ett attesterat underlag skrivs inte om.",
      handling: "vidare",
    },
  ],
};

export const LONEKOSTNAD_NAV2: Guide = {
  slug: "lonekostnad",
  titel: "Satser och löner",
  beskrivning: "Vad en säljare kostar, och varför siffran inte är ett löneunderlag.",
  version: 2,
  omtag: true,
  minuter: 2,
  roller: [],
  behorighet: "payroll_cost_viewer",
  steg: [
    {
      ankare: "[data-satsga]",
      rubrik: "Satser och löner",
      text: "Under Inställningar, Administration. Lönerna delas ut som en egen behörighet, inte med en roll.",
      handling: "vidare",
      vag: "/installningar/admin",
    },
    {
      rubrik: "En uppskattning för beslut",
      text: "Vad en säljare kostar och hur mycket säljaren behöver sälja för att bära sin kostnad. Det är underlag för beslut, inte ett löneunderlag.",
      handling: "vidare",
    },
    {
      rubrik: "Behandla den som personuppgift",
      text: "Raderna säger vad namngivna personer kostar. Att du ser dem betyder inte att de får delas vidare.",
      handling: "vidare",
    },
  ],
};

export const FRAGA_NAV_NAV2: Guide = {
  slug: "fraga-nav",
  titel: "Fråga Nav",
  beskrivning: "Sök, gör och fråga från samma ruta.",
  version: 1,
  minuter: 1,
  roller: [],
  steg: [
    {
      ankare: ".rls-sok, .cmdk-btn",
      rubrik: "En ruta för allt",
      text: "Tryck ⌘K, eller på sökfältet. Skriv ett namn, en rutin eller en kurs, så hittar Nav det.",
      handling: "vidare",
      vag: "/",
    },
    {
      rubrik: "Gör direkt",
      text: "Skriv vad du vill göra, som ”ny order” eller ”sjukanmäl”, så öppnar Nav rätt formulär.",
      handling: "vidare",
    },
    {
      rubrik: "Fråga",
      text: "Nav föreslår frågor medan du skriver, som ”Hur många semesterdagar har jag kvar?”, och svarar ur dina egna uppgifter.",
      handling: "vidare",
    },
  ],
};

/** Ordningen är ordningen i Lär dig Nav: orienteringen först, sedan det alla har, sist ledningens. */
export const GUIDER_NAV2: Guide[] = [
  KOM_IGANG_NAV2,
  STAMPLA_NAV2,
  UPPGIFTER_NAV2,
  RUTINER_NAV2,
  ORDER_NAV2,
  FRANVARO_NAV2,
  FRAGA_NAV_NAV2,
  NYHETER_NAV2,
  ARENDEN_NAV2,
  FEL_NAV2,
  AVTAL_NAV2,
  PROVISION_NAV2,
  PERSONAL_NAV2,
  REKRYTERING_NAV2,
  LONERAPPORT_NAV2,
  LONEKOSTNAD_NAV2,
];
