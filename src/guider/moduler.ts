import type { Guide } from "./typer.ts";

/**
 * Modulguiderna — en per del av navet, mot den riktiga sidan.
 *
 * ===========================================================================
 * DE PEKAR UT OCH FÖRKLARAR. DE SKAPAR INGENTING.
 *
 * Beställningen (docs/SYSTEMGUIDER.md, punkt 1) säger att en tur ska kräva att
 * användaren gör momentet. Det löftet går inte att hålla förrän övningsläget
 * finns: en guide som ber någon lägga en order på riktigt lägger en riktig
 * order, som går till leverans och räknas i provisionsunderlaget.
 *
 * Tills G3 är byggd är de här guiderna därför den ärliga halvan — de visar var
 * saker ligger och förklarar de regler som INTE syns i gränssnittet: att en
 * makulering dras i makuleringsmånaden, att en rättelse blir en ny rad, att
 * sjukanmälan rings in först. Det är det som annars lärs ut i förbifarten och
 * glöms bort.
 *
 * När G3 finns byggs momenten in i samma filer, versionen höjs med `omtag`, och
 * då — och först då — kräver de handling hela vägen.
 * ===========================================================================
 *
 * ANKARNA SITTER PÅ SAKER SOM ALLTID RITAS. En ny anställd har inga order,
 * inga ärenden och ingen ledighet, så ett ankare på en listrad hade gjort
 * guiden trasig för exakt den person den är till för. Därför pekar de på kort,
 * rubriker och knappar — och listorna pekas ut genom sitt omslag, som finns
 * även när det står "inga träffar" i det.
 */

export const RUTINER: Guide = {
  slug: "rutiner-och-kvittens",
  titel: "Rutiner och kvittenser",
  beskrivning: "Var arbetssätten står, och vad en kvittens betyder.",
  version: 1,
  minuter: 3,
  roller: [],
  modul: "/rutiner",
  steg: [
    {
      rubrik: "Rutiner",
      text: "Det här är arbetssätten du förväntas följa. Tre minuter, så vet du hur du hittar i dem.",
      handling: "vidare",
      vag: "/rutiner",
    },
    {
      ankare: "rutiner.filter",
      rubrik: "Sök eller filtrera",
      text:
        "Sökfältet går på titeln och innehållet. Chipsen under filtrerar på kategori. " +
        "Mitt i ett samtal är sökningen snabbare än att bläddra.",
      handling: "vidare",
    },
    {
      ankare: "rutiner.lista",
      rubrik: "Färgen på kanten säger något",
      text:
        "Gul kant betyder att dokumentet väntar på DIN kvittens. Röd betyder att granskningen " +
        "förfallit — då är det ägarens sak, inte din.",
      handling: "vidare",
    },
    {
      rubrik: "Kvittensen görs inne i dokumentet",
      text:
        "Du öppnar rutinen, läser, och kvitterar längst ner. Kommer en ny version av något du " +
        "redan kvitterat dyker den upp i klockan igen — kvittensen gäller den version du läste.",
      handling: "vidare",
    },
  ],
};

export const ARENDEN: Guide = {
  slug: "arenden",
  titel: "Ärenden",
  beskrivning: "Frågor till ledningen som inte försvinner i en chatt.",
  version: 1,
  minuter: 3,
  roller: [],
  modul: "/arenden",
  steg: [
    {
      rubrik: "Ärenden",
      text:
        "Lön, utrustning, schema, arbetsmiljö — allt som annars ställs i förbifarten och glöms bort. " +
        "Här finns frågan kvar, och svaret också.",
      handling: "vidare",
      vag: "/arenden",
    },
    {
      ankare: "arenden.nytt",
      rubrik: "Så skriver du ett",
      text:
        "Du väljer kategori, och kategorin bestämmer utlovad svarstid. Kryssar du i " +
        "konfidentiellt ser bara säljchefen och VD ärendet — inte din närmaste chef.",
      handling: "vidare",
    },
    {
      ankare: "arenden.lista",
      rubrik: "Klockan räknar ner",
      text:
        "Varje ärende visar hur många timmar som är kvar av svarstiden. Går den över blir " +
        "märket rött, och det syns för den som ska svara.",
      handling: "vidare",
    },
    {
      rubrik: "Klart",
      text: "Du ser hela dialogen i ärendet, och får en notis i klockan när någon svarar.",
      handling: "vidare",
    },
  ],
};

export const FRANVARO: Guide = {
  slug: "franvaro",
  titel: "Frånvaro och ledighet",
  beskrivning: "Söka ledigt, sjukanmäla sig, och se vad som är beslutat.",
  version: 1,
  minuter: 3,
  roller: [],
  modul: "/franvaro",
  steg: [
    {
      rubrik: "Frånvaro",
      text: "Två saker som ser lika ut men fungerar olika: ledighet söks i förväg, sjukfrånvaro anmäls samma dag.",
      handling: "vidare",
      vag: "/franvaro",
    },
    {
      ankare: "franvaro.ansok",
      rubrik: "Två vägar, inte en",
      text:
        "Söka ledigt är en ansökan som chefen beslutar om. Sjukanmälan är ett besked — " +
        "och du ringer din chef först, sedan registrerar du den här. Ringandet är inte något " +
        "navet kan göra åt dig.",
      handling: "vidare",
    },
    {
      ankare: "franvaro.vantar",
      rubrik: "Vad som väntar på beslut",
      text:
        "Inskickade ansökningar ligger här tills chefen tagit ställning. Du får en notis när " +
        "beslutet kommer — du behöver inte gå in och titta.",
      handling: "vidare",
    },
    {
      rubrik: "Klart",
      text:
        "Godkänd ledighet flyttar ner till Kommande och syns i chefens planering. " +
        "Behöver du ändra en ansökan som redan är beslutad: lägg ett ärende.",
      handling: "vidare",
    },
  ],
};

export const STAMPLA: Guide = {
  slug: "stampla-in-och-ut",
  titel: "Stämpla in och ut",
  beskrivning: "Knapparna, dagens rader, och vad som händer om du glömmer.",
  version: 1,
  minuter: 3,
  roller: [],
  /**
   * Gäller bara den som faktiskt stämplar. Vem det är avgörs av
   * `src/lib/stampelfri.ts` och av modulens spärr — aldrig av en rollista här.
   * En andra kopia av den listan hade glidit isär från originalet, och det är
   * exakt vad filen varnar för.
   */
  krav: "stamplar",
  modul: "/tid",
  steg: [
    {
      rubrik: "Tiden",
      text: "Tre minuter om knapparna, raderna och det som händer när du glömmer stämpla ut.",
      handling: "vidare",
      vag: "/tid",
    },
    {
      ankare: "tid.knappar",
      rubrik: "Tiden sätts när du trycker",
      text:
        "Inte när sidan laddades, inte när servern svarade. Trycker du utan täckning sparas " +
        "tiden i telefonen och skickas när nätet är tillbaka — den tiden är den som gäller.",
      handling: "vidare",
    },
    {
      ankare: "tid.idag",
      rubrik: "Ingen rad går att ändra",
      text:
        "En stämpling kan varken redigeras eller tas bort. Blev det fel begär du en rättelse, " +
        "och rättelsen blir en NY rad som chefen beslutar om. Historiken skrivs aldrig om.",
      handling: "vidare",
    },
    {
      rubrik: "Glömd utstämpling",
      text:
        "Nattjobbet stänger dagen åt dig enligt ditt schema och märker den. Det är ingen " +
        "anklagelse — men en dag som står öppen blockerar löneperioden, så rätta den när du ser den.",
      handling: "vidare",
    },
  ],
};

export const ORDER: Guide = {
  slug: "registrera-order",
  titel: "Order",
  beskrivning: "Var siffrorna kommer ifrån och hur en order tar sig vidare.",
  version: 1,
  minuter: 4,
  roller: ["salesperson", "sales_manager", "ceo", "finance"],
  modul: "/order",
  steg: [
    {
      rubrik: "Order",
      text: "Fyra minuter om månadens siffror, formuläret och vad som händer efter att du skickat in.",
      handling: "vidare",
      vag: "/order",
    },
    {
      ankare: "order.manad",
      rubrik: "Netto, inte brutto",
      text:
        "Siffran är godkända order minus det som makulerats. En makulering dras i den månad den " +
        "MAKULERADES, inte i månaden ordern tecknades — och en stängd månad skrivs aldrig om.",
      handling: "vidare",
    },
    {
      ankare: "order.ny",
      rubrik: "Provisionen kommer ur matrisen",
      text:
        "Du väljer paket och signeringsdatum. Satsen hämtas ur paketmatrisen efter " +
        "signeringsdatumet — inte efter dagens datum. Ändras matrisen senare rör det inte din order.",
      handling: "vidare",
    },
    {
      rubrik: "Inskickat är inte godkänt",
      text:
        "Ordern går till säljchefen och räknas inte i provisionen förrän den godkänts. " +
        "Du ser den ligga och vänta, och du får en notis när den är avgjord.",
      handling: "vidare",
    },
  ],
};

export const PROVISION: Guide = {
  slug: "las-din-provision",
  titel: "Din provision",
  beskrivning: "Vad siffran betyder, var den kommer ifrån och när den låser sig.",
  version: 1,
  minuter: 3,
  roller: ["salesperson", "sales_manager", "ceo", "finance"],
  modul: "/provision",
  steg: [
    {
      rubrik: "Provision",
      text: "Tre minuter om vad siffran är — och vad den inte är.",
      handling: "vidare",
      vag: "/provision",
    },
    {
      ankare: "provision.min",
      rubrik: "Intjänat, inte utbetalt",
      text:
        "Det här är vad du arbetat ihop, inte vad som ligger på kontot. Lönen betalas som vanligt " +
        "av lönesystemet. En öppen månad räknas live och ändras med varje ny order; en fastställd " +
        "månad står stilla.",
      handling: "vidare",
    },
    {
      ankare: "provision.varifran",
      rubrik: "Tre källor",
      text:
        "Grundprovisionen ur dina order och paketmatrisen. Volymbonusen på hela månadens volym. " +
        "Och poster som ekonomi eller VD bokfört för hand — en post skrivs aldrig om, en rättelse " +
        "blir en egen negativ post.",
      handling: "vidare",
    },
    {
      rubrik: "Om siffran inte stämmer",
      text:
        "Lägg ett ärende i stället för att fråga i förbifarten. Då finns frågan kvar, och svaret " +
        "också — och den som räknar kan se exakt vilken månad du menar.",
      handling: "vidare",
    },
  ],
};

export const AVTAL: Guide = {
  slug: "avtal",
  titel: "Avtal",
  beskrivning: "Ditt anställningsavtal, och varför texten fryses.",
  version: 1,
  minuter: 2,
  roller: [],
  modul: "/avtal",
  steg: [
    {
      rubrik: "Avtal",
      text: "Två minuter. Sidan visar olika saker beroende på vem du är — dina egna avtal, eller allas.",
      handling: "vidare",
      vag: "/avtal",
    },
    {
      ankare: "avtal.rubrik",
      rubrik: "Ditt eget avtal utan att fråga någon",
      text:
        "Är du inte chef ser du dina egna utfärdade avtal och ingenting annat. Att kunna läsa sitt " +
        "anställningsavtal utan att be någon leta upp det är hela nyttan med sidan.",
      handling: "vidare",
    },
    {
      ankare: "avtal.lista",
      rubrik: "Texten fryses när avtalet utfärdas",
      text:
        "Avtalet skapas ur en mall, men blir en egen text i samma stund det utfärdas. Ändras mallen " +
        "sedan rör det inte ditt avtal — det som står där är det som gällde när du skrev under.",
      handling: "vidare",
    },
    {
      rubrik: "Papper, fortfarande",
      text:
        "E-signering är inte byggd. Ett utfärdat avtal skrivs ut och skrivs under för hand, och " +
        "personnumret fylls i på papperet: navet lagrar inga personnummer.",
      handling: "vidare",
    },
  ],
};

export const NYHETER: Guide = {
  slug: "nyheter",
  titel: "Nyheter",
  beskrivning: "Besked från ledningen, och varför du ser just dem du ser.",
  version: 1,
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
      ankare: "nyheter.rubrik",
      rubrik: "Riktat, inte allmänt",
      text:
        "Ett inlägg kan riktas till en roll eller ett team. Du ser det som gäller dig — så att " +
        "listan är kort nog att faktiskt läsas.",
      handling: "vidare",
    },
    {
      ankare: "nyheter.lista",
      rubrik: "Det viktiga ligger överst",
      text:
        "Ett inlägg märkt Viktigt fästs i toppen och stannar där tills det tas ner. Nya inlägg " +
        "säger till i klockan.",
      handling: "vidare",
    },
  ],
};

export const FEL: Guide = {
  slug: "rapportera-fel",
  titel: "Rapportera fel",
  beskrivning: "Vad du gör när navet gör fel — och varför det är värt en halv minut.",
  version: 1,
  minuter: 2,
  roller: [],
  modul: "/fel",
  steg: [
    {
      rubrik: "Fel",
      text: "Två minuter. Den här sidan är den enda vägen som fungerar när något annat inte gör det.",
      handling: "vidare",
      vag: "/fel",
    },
    {
      ankare: "fel.rapportera",
      rubrik: "Skriv vad du gjorde, inte vad du tror",
      text:
        "Vilken sida, vad du tryckte på, och vad som hände i stället. Navet fyller själv i vem du " +
        "är och var du var — du behöver inte återskapa felet för att rapportera det.",
      handling: "vidare",
    },
    {
      ankare: "fel.rubrik",
      rubrik: "Du ser vad som hänt med den",
      text:
        "Din rapport ligger kvar här tills den är avgjord. Ett fel som träffat flera personer blir " +
        "en rad med en räknare, inte en rad per gång — så rapportera även om du tror att någon " +
        "annan hunnit före.",
      handling: "vidare",
    },
  ],
};

export const KV: Guide = {
  slug: "kv-protokollet",
  titel: "K&V",
  beskrivning: "Två samtal i veckan, sex områden, och vad en godkänd vecka ger.",
  version: 1,
  minuter: 3,
  roller: ["salesperson", "sales_manager", "ceo", "finance"],
  modul: "/kv",
  steg: [
    {
      rubrik: "K&V",
      text: "Tre minuter om protokollet och om vad det hänger ihop med.",
      handling: "vidare",
      vag: "/kv",
    },
    {
      ankare: "kv.rubrik",
      rubrik: "Två samtal i veckan, sex områden",
      text:
        "Din säljchef lyssnar på två samtal och bedömer dem på sex områden. En godkänd vecka ger " +
        "bonus på månadens provision — det är därför bedömningen finns, och därför den är " +
        "skriven och inte muntlig.",
      handling: "vidare",
    },
    {
      rubrik: "Utan regler räknas ingenting",
      text:
        "Reglerna sätts per månad. Är de inte satta för den månad du tittar på räknas inga " +
        "bedömningar — då står det en gul ruta här, och den är riktad till din chef, inte till dig.",
      handling: "vidare",
    },
    {
      rubrik: "Du ser din egen kurva",
      text:
        "Varje bedömning ligger kvar, så du kan se vad som gått framåt över tid. Din chef ser " +
        "rutnätet över alla — du ser dina egna.",
      handling: "vidare",
    },
  ],
};
