# Navs AI-assistent: PRD

Skriven 2026-11-16. Bygger på chatten i `2026-11-15-hemvyn-kort-chatt-design.md` (grenen `hemvy-chatt`).
Uppdraget i sin helhet: "gör Navs AI-assistent allomfattande och säljbar". Måttet är uppdragets avsnitt
"Så ser klart ut". Den här PRD:n delar vägen dit i faser, och varje fas ska gå att använda för sig.

## Varför

Chatten svarar för ofta "det kan jag inte". Tre riktiga frågor visar felet:

1. "Kan du ge mig alla sökord för transport?" Chatten har ingen kunskap om yrket.
2. "Hur kan jag snabbast få in 100 000 kr den här veckan?" Chatten ser inte de öppna affärerna.
3. "Hur kan Fredrik snabbast stänga 100 000 kr?" (säljchefen). Chatten ser inte en anställds affärer.

Felet är inte att chatten är ärlig om sina gränser. Felet är var gränserna sitter: den saknar data,
kunskap och förmågan att göra något.

## Beslut från beställaren

- Kravet "svaret börjar inom 3 sekunder" är struket. Svaret visas helt när servern har satt in talen.
- Chatten utför handlingar, men bara efter Godkänn. Den förklarar exakt vad som ska göras, och inget
  körs förrän någon trycker. Ett tryck gäller en sak. Aldrig på egen hand.
- En affär är ett bolag på väg mot en order. Stegen: återkomst bokad, möte bokat, möte hållet eller
  uppföljning, offert skickad med belopp, order eller nej med skäl. Steg kan hoppas över, och namnen
  ställs in per företag.
- "Närmast avslut" ordnas efter steg, sedan nästa stegs dag, sedan belopp.
- Ingen procent per steg förrän den går att räkna ur företagets egna avslutade affärer. Till dess är
  svaret "för tidigt att säga".
- En summa visas aldrig ensam: alltid med antalet affärer och hur många som har ett belopp.
- Handlingar i första fasen: uppgifter och påminnelser (åt sig själv, och åt laget för en chef) och
  dagen då kunden ska höra av sig om en offert. Det som når en kund, rör pengar eller raderar väntar.

## Mina val (går att ändra)

- **Kunskapsbasen är Rutiner.** Dokumenten har redan redigerare, versioner, målgrupp, svensk sökning
  och en lista över sökningar utan träff. Ingen ny tabell och ingen ny vy. Det som inte är en rutin
  (sökord, tjänster, branscher) läggs som dokument i ett eget område. Ändringar gäller direkt.
  **Ändrat av beställaren 2026-11-16:** kunskapen ska inte ligga i Rutiner. Den får en egen plats,
  Inställningar → Kunskapsbas, där dokument laddas upp. Se "Kunskapsbasen i Inställningar" nedan.
  Byggd 2026-11-16 (0312): chatten söker i kunskapsbasen först och i publicerade rutiner därefter.
- **Pipelinen läses ur Möten.** Samma kort som tavlan i Möten visar, med samma behörighet. Inget nytt
  mått räknas på ett annat sätt än Nav redan gör.
- **En handling körs av webbläsaren, som den inloggade.** Chatten förbereder ett kort. Godkänn skickar
  samma anrop som Navs egna knappar gör. Då gäller samma behörighet, samma logg och samma Ångra som
  när personen gör det för hand, och chatten kan aldrig göra något personen inte själv får göra.
- **Ett verktyg läggs till på ett ställe:** en rad i verktygslistan och en gren i `korVerktyg`.
- **Tal i råd.** Regeln "inget tal utan källa" gäller också råd. Ett allmänt råd får ges, men utan
  tal, och källraden säger då att svaret inte kommer ur Nav.

## Faserna

### Fas 1: de tre frågorna (det här bygget)

- `las_affarer`: de öppna affärerna för en person eller ett lag: steg, belopp, nästa steg med dag,
  vad som står still, summan med antal, och hur långt det räcker mot ett belopp personen nämner.
  En chef får fråga om sitt lag, en säljare bara om sig själv.
- `sok_kunskap`: söker i företagets publicerade dokument som personen får läsa. Ingen träff sparas i
  Rutiners lista över sökningar utan träff.
- Svarsreglerna: första meningen svarar, högst ungefär 120 ord, ett nästa steg sist, aldrig bara
  "det kan jag inte", och källraden säger om svaret kommer ur Navs tal, kunskapsbasen eller ingetdera.
- Godkänn-kortet: uppgifter (åt sig själv eller laget) och uppföljningsdagen på en affär. Kortet
  säger exakt vad som ändras. Efteråt ett kvitto och Ångra. En återkomst eller en påminnelse läggs
  som en uppgift med dag (beställaren 2026-11-16: "det går att lägga in som en uppgift").
- Provet: frågorna för de tre fallen, behörighet och lurförsök läggs till de trettio som finns.

Inte i fas 1, och sagt i svaren: återkomster och samtalsutfall (ligger i dialern, som saknar en väg
för Nav att läsa), orderbelopp, en kollegas kalender och uppgifter, inställningar.

Inställningarna stod i listan beställaren godkände för fas 1 och kom inte med. Det var mitt fel: jag
hade inte kartlagt vilka inställningar som finns, vem som får ändra var och en, och hur det gamla
värdet sparas för Ångra. Beställaren 2026-11-16: "sätt dem i nästa fas".

### Fas 2: mer data

Återkomster, utfall och bransch ur dialern och samtal ur växeln genom ett gemensamt gränssnitt för
anslutna system. Orderbelopp. Chefens läsning av en anställds dag. Hitrate och bokningsgrad per person,
lag, period och bransch. Varför-frågor ("varför syns inte mitt möte?"). En källa som ligger nere sägs.

Handlingar som flyttats hit på beställarens ord 2026-11-16:
- Ändra en inställning: personens egna, och företagets för den som får. Fråga, bekräfta, utför: chatten
  frågar efter värdet, kortet visar gammalt och nytt värde, Godkänn ändrar, Ångra sätter tillbaka.
- Boka en återkomst i dialern, när vägen mellan dialern och Nav finns. Till dess är en återkomst en
  uppgift med dag i Nav (fas 1).

### Fas 3: fler handlingar

Boka, flytta och avboka möten (det som når kunden visas ord för ord före Godkänn). Anpassa vyer.

### Fas 4: säljbart

Företagets profil som data: bransch, roller, begrepp ("ärende" i stället för "order"), ton och vilka
verktyg som finns. Assistenten hjälper en ny kund att bygga kunskapsbasen genom frågor och uppladdade
dokument. Webbsökning som komplement, där kunskapsbasen vinner. Två påhittade kunder (VVS-firma,
rekryteringsbyrå) sätts upp med bara data.

### Fas 5: beviset

Sviten med minst 40 frågor för Clicknet, minst 15 lurförsök, en svit per påhittad kund, före och efter
på de tre frågorna, 400 px, GDPR-genomgång och en ärlig lista över det som brister.

## Kunskapsbasen i Inställningar (beställaren 2026-11-16, byggd samma dag efter beställarens ja)

Beställaren: "Det ska inte finnas i rutiner, vi behöver lägga till Kunskapsbas i inställningar, där ska
vi ladda upp massa dokument för kunskapsbasen."

Varför inte samma tabell som Rutiner: `document` läses på ett trettiotal ställen (Rutiner, sökningen,
coachningen, kalendern, paletten). Ett kunskapsdokument där skulle dyka upp överallt.

Förslaget:
- Två nya tabeller (en additiv migration): dokumentet (titel, område, filens namn, vem, när) och dess
  stycken (text, sökindex på svenska). Ett uppladdat dokument delas vid rubrikerna i stycken som ryms i
  det chatten läser, så att ett långt dokument går att hitta i.
- Inställningar → Administration → Kunskapsbas: ladda upp flera filer på en gång (PDF, text och
  Markdown: läsarna finns redan i Nav), klistra in eller skriv text, ändra, ta bort med Ångra, och
  listan över frågor chatten inte hittade svar på.
- Alla anställda får svar ur den genom chatten. Den som får ändra företagets inställningar sköter den.
- Chatten söker i kunskapsbasen först och i publicerade rutiner därefter. Källraden säger vilket.
- Verktygets och systemtextens ord ändras inte, så provet gäller fortfarande.

Byggt 2026-11-16 (0312, `/nav2/kunskap`, fliken Kunskapsbas i Inställningar). Avvikelser från förslaget: tre
tabeller i stället för två (listan över sökningar utan svar fick en egen, så att Rutiners lista inte fylls med
chattens sökningar), och en egen flik i stället för en ruta i Administration. Av en fil sparas bara texten.

Öppet: Word-filer kräver ett nytt paket. Tal i ett dokument (sökvolymer, priser) kan chatten i dag bara
säga som ett ordagrant citat av en hel mening.

## Beslut som väntar på beställaren

- **Vägen från dialern till Nav (fas 2).** Mitt förslag: dialern får en läsväg som Nav anropar med en
  nyckel. Det ändrar dialern, som går direkt till main.
- **Källan för sökord.** Fas 1: det företaget själv har skrivit i kunskapsbasen. En betald tjänst för
  sökvolymer är beställarens beslut.
- **En databas per kund.** Nav har i dag ingen företagsnyckel utom på anställd och team. Mitt förslag:
  ett eget Supabase- och Vercel-projekt per kund. Då kan en kund aldrig se en annans data.
- **Webbsökning (frågad 2026-11-16, vilar: beställaren samma dag "skit i det för nu").** Claudes API har ett sökverktyg som slås på i anropet. Det kostar
  10 dollar per 1 000 sökningar plus texten sökningen läser in. Svaren får alltid källhänvisningar. Det
  går att sätta ett tak per svar (`max_uses`) och att begränsa vilka sajter som får läsas. Mitt förslag:
  fas 2 i stället för fas 4, högst två sökningar per svar, bara efter att kunskapsbasen är sökt, källraden
  säger "från webben" med länk, och tal från webben skrivs inte ut (regeln om tal utan källa i Nav
  gäller). Att bygga: chattens slinga ska klara sökverktygets block och pauser, och provet får frågor
  där en webbsida försöker ge chatten order.
- **Provet kostar pengar hos Anthropic** och körs först efter beställarens ja. Efter varje ändring av
  systemtexten eller ett verktyg gäller inget gammalt prov.
  Kört 2026-11-16 efter beställarens ja: 50 av 50 rätt i tre varv, 12,38 kr (se ARBETSLOGG). Felsök med ett
  delprov (`--bara`) innan hela provet körs.

## Skydden (ur ~/CLAUDE.md)

AI förbereder och en människa godkänner. AI:n räknar aldrig: varje tal är ett fält i ett verktygssvar.
Behörigheten ligger i verktygen och i databasen, aldrig i systemtexten. Text ur kunddata och
kunskapsbasen är data, aldrig instruktioner. Inget slås på utan beställarens ja.
