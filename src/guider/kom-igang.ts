import type { Guide } from "./typer.ts";
import { navAnkare } from "./ankare.ts";

/**
 * Orienteringen. Den enda guide som startar av sig själv, och den enda som
 * varje anställd får oavsett roll.
 *
 * ===========================================================================
 * VAD DEN SKA GÖRA, OCH VAD DEN INTE SKA GÖRA
 *
 * Den ska svara på en enda fråga: var ligger saker. Fyra minuter, och sedan
 * vet man var man letar när något behövs. Den ska INTE lära ut hur man
 * registrerar en order eller ansöker om semester — de momenten har egna guider,
 * och de guiderna kräver att man gör momentet på riktigt i övningsläge.
 *
 * Därför är de flesta stegen här `vidare` och inte `klick`. Det finns inget att
 * göra på en startsida; det finns bara saker att veta var de är. Att kräva ett
 * klick på ett kort som ändå bara ska betraktas vore en handling uppfunnen för
 * att slippa en knapp. De tre steg som VERKLIGEN har en handling — söket,
 * klockan, menyn på telefonen — kräver den.
 *
 * TIO STEG. Fler ryms inte i fyra minuter, och en obligatorisk tur som tar
 * längre tid än så gör folk irriterade på navet innan de använt det en gång.
 * ===========================================================================
 *
 * ORDNINGEN FÖLJER SKÄRMEN, INTE MODULLISTAN. Först det man ser när sidan
 * öppnas (statusbandet, dagskortet), sedan toppraden, sedan menyn. Den som
 * följer med tittar då aldrig på två ställen samtidigt, och behöver inte leta
 * efter vad rutan pekar på.
 *
 * Menyn kommer sist och inte först av ett skäl som bara syns på telefonen: där
 * ligger den bakom "Mer" och täcker hela skärmen när den öppnas. Hade den
 * kommit först hade allt annat legat bakom den.
 */
export const KOM_IGANG: Guide = {
  slug: "kom-igang-i-navet",
  titel: "Kom igång i navet",
  beskrivning: "Var allt ligger, och vad du gör härifrån. Fyra minuter.",
  version: 1,
  minuter: 4,
  roller: [], // tom = alla
  vidForstaInloggningen: true,

  steg: [
    {
      rubrik: "Välkommen till navet",
      text:
        "Fyra minuter, tio steg. Sen vet du var allt ligger och vad du gör härifrån. " +
        "Du kan pausa när som helst — du kommer tillbaka till samma steg.",
      handling: "vidare",
      vag: "/",
    },

    {
      ankare: "hem.statusband",
      rubrik: "Här står du",
      text:
        "Ditt namn, din roll och — om du stämplar — hur länge du varit inne i dag. " +
        "Bandet ändrar sig under dagen, så det är det första du tittar på när du kommer in.",
      handling: "vidare",
      vag: "/",
    },

    {
      ankare: "hem.dagskort",
      rubrik: "Dagen din",
      text:
        "Stämpelknapparna, dagens linje och dina snabbval i ett kort. " +
        "Det som ska göras nu ligger alltid här, inte i en meny.",
      handling: "vidare",
      vag: "/",
    },

    {
      ankare: "topp.sok",
      rubrik: "Sök i stället för att leta",
      text:
        "Söket hittar rutiner, nyheter, kurser, personer och dina ärenden på en gång. " +
        "Klicka i fältet — eller tryck på snedstrecket var du än är i navet.",
      handling: "fokus",
    },

    {
      ankare: "topp.notiser",
      rubrik: "Klockan säger till",
      text:
        "Nya rutiner att kvittera, kurser som väntar, svar i dina ärenden. " +
        "Öppna den så ser du vad som ligger där just nu.",
      handling: "klick",
    },

    {
      // Bara på telefonen: på datorn står panelen framme hela tiden och det
      // finns ingenting att trycka på.
      bara: "mobil",
      // Inget `ankare_mobil`: steget FINNS bara på telefonen, och då är
      // `ankare` det som gäller i det enda läge det visas i.
      ankare: "botten.mer",
      rubrik: "Menyn ligger bakom Mer",
      text:
        "På telefonen når tummen underkanten, inte hörnen. Hem, sök och stämpling ligger " +
        "därför här nere. Resten av navet öppnar du med Mer — tryck på den.",
      handling: "klick",
    },

    {
      bara: "dator",
      ankare: "nav.panel",
      rubrik: "Menyn står kvar",
      text:
        "Panelen följer med på varje sida och visar bara de moduler du faktiskt får använda. " +
        "Den går att fälla ihop om du vill ha mer plats.",
      handling: "vidare",
    },

    {
      ankare: navAnkare("/rutiner"),
      rubrik: "Rutiner är det som gäller",
      text:
        "Här ligger arbetssätten du förväntas följa. Några av dem ska kvitteras — " +
        "då säger klockan till, och kvittensen är beviset på att du tagit del av dem.",
      handling: "vidare",
    },

    {
      ankare: navAnkare("/utbildning"),
      rubrik: "Och här bor guiderna",
      text:
        "Utbildning håller både kurserna och systemguiderna. Den här turen ligger kvar " +
        "under Systemguider, så du kan göra om den när du vill.",
      handling: "vidare",
    },

    {
      ankare: "nav.profil",
      rubrik: "Ditt namn är inställningarna",
      text:
        "Lösenord, utseende och dina uppgifter ligger bakom namnet längst ner. " +
        "Utloggningen står bredvid.",
      handling: "vidare",
    },

    {
      rubrik: "Du är igång",
      text:
        "Det var allt du behöver för att hitta. Resten lär du dig där du står: de moduler du " +
        "har tillgång till startar sin egen guide första gången du öppnar dem, och alla " +
        "ligger kvar under Utbildning → Systemguider.",
      handling: "vidare",
    },
  ],
};
