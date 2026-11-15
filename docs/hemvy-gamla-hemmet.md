# Det gamla hemmet, sak för sak

Regeln är att ingen funktion försvinner. Här står allt som det gamla hemmet
visar och var samma sak finns för den som har det nya hemmet (`hem.nytt`).

Det gamla hemmet är orört. Alla som inte står i `hem.nytt` ser det precis som
förut, och det tas bort först när beställaren säger till.

Senast genomgånget: 2026-11-15, mot `src/nav2/utkast.html` på grenen
`hemvy-chatt`.

## Så läser du listan

Varje sak har en av fyra platser i det nya hemmet:

- **Kort**: syns direkt på hemmet.
- **Ett klick**: bakom ett kort eller en genväg på hemmet.
- **Menyraden**: i en annan vy, som nås som vanligt.
- **Skrivrutan**: skriv vad du vill göra, så öppnas det.

## Överst på sidan

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Hälsningen och dagens datum (`hello`) | Hälsningen står kvar, datumet står i överraden. | Kort |
| Knappen Sök, gör eller fråga Nav | Skrivrutan längst ned. ⌘K fungerar som förut. | Kort |
| Klockan med olästa notiser | Klockan i menyraden. På telefonen under Mer. | Menyraden |

## Stämpelkortet (`renderHub`)

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Stämpla in och Stämpla ut | Knappen i överraden. Den visar "Inne sedan 08.02" när du är inne. | Kort |
| Dagens stämplingar mot schemat, arbetad tid, kvar av schemat | Tid, under Mina stämplingar. | Menyraden |
| Snabbvalen: Ansök om ledighet, Sjukanmälan, Nytt ärende, Mina stämplingar | Skrivrutan: skriv "ledighet", "sjuk" eller "ärende". Finns också i Frånvaro, Ärenden och Tid. | Skrivrutan |
| Dagens slut: "Det här hann du i dag" och "Först på måndag" | Genvägen Veckan. Vid dagens slut säger Nav hur många uppgifter som blev klara och vad som är kvar, och nästa arbetsdag står under. | Ett klick |
| Chefen: hur många som är på plats, och vilka som är sjuka, lediga eller inte instämplade | Talet i överraden. Ett klick visar laget, person för person. | Kort |
| Chefen: vilka som är borta de kommande 7 och 14 dagarna | Genvägen Veckan visar vilka som är borta nästa arbetsdag och de närmaste dagarna. Längre fram står i Frånvaro. | Ett klick |
| Chefen: Attestera ledighet, Ärendekön, Tid att besluta | Raderna i Väntar på dig. Samma saker, med samma knappar. | Kort |
| Chefen: Bokför provision | Genvägen Veckan, under Att få klart i veckan. Finns också i Provision. | Ett klick |
| Chefen: Sena i dag | Tid, fliken Sena. | Menyraden |
| Chefen: Avsluta dagen, se nästa arbetsdag | Genvägen Veckan. | Ett klick |

## Din dag i korthet (`renderBrief`)

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| De tre saker som brinner mest | Raden under hälsningen säger hur många som brinner. Kortet Väntar på dig visar de fyra översta. | Kort |
| "Sedan du tittade": vad som är nytt i klockan | Överst i hela listan bakom Väntar på dig. | Ett klick |
| Lyssna: få sammanfattningen uppläst | Knappen Lyssna i hela listan. | Ett klick |
| Klick på källan öppnar saken | Klick på radens rubrik i hela listan. | Ett klick |
| Stämmer inte | Radens meny (tre prickar) i hela listan. Raden går till kön för fel och räknas inte längre på hemmet. Den står kvar i listan, märkt. | Ett klick |
| Visa inte X här | Radens meny i hela listan. Sorten räknas inte på hemmet men står kvar i listan, och går att ta tillbaka där. | Ett klick |
| Fråga något mer | Skrivrutan. | Kort |

## Kräver dig (`renderInbox`)

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Listan med allt som väntar, i grupperna Nu, Senare i dag och Kan vänta | Kortet Väntar på dig och hela listan bakom det. Det är samma lista: löst på ett ställe är löst på båda. | Kort |
| Knapparna Klar, Kvittera, Bekräfta och Bevilja | Samma knappar på samma rader. | Kort |
| Tangenterna J, K, E och Enter | Fungerar i hela listan. | Ett klick |
| Alla uppgifter | Genvägen Min dag öppnar Att göra. Uppgifter finns i menyraden. | Ett klick |
| Pricken "nytt sedan sist" på en uppgift | På uppgiftens rad, i kortet och i hela listan. | Kort |

## Golvet just nu (`renderGolvet`)

Beställaren har bestämt att Golvet bor på Säljtavlan och inte på hemmet. Tavlan
på kontoret visar dagens order, men där går det inte att gratulera. Därför
finns Golvet ett klick bort i det nya hemmet.

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Dagens signerade order, med belopp och klockslag | Genvägen Golvet. | Ett klick |
| Grattis på en kollegas order | Genvägen Golvet. Samma knapp, och säljaren får samma pling. | Ett klick |
| Lagets order i månaden mot målet | Genvägen Golvet, och kortet Teamet i månaden för den som leder ett lag. | Ett klick |
| Rutan som säger till när en kollega signerar | Kommer som förut, en gång i minuten. | Kort |
| Möten: kortet med tre tal, och mötesstatistikens rad | Möten. | Menyraden |

## Chefens kort

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Teamet i månaden: signerat, mål, takt och prognos (`renderTeamGoal`) | Kortet Teamet i månaden. Takten visas som en uträkning med sitt eget facit bredvid, inte som ett löfte. | Kort |
| "N order väntar på ditt godkännande" | En rad i Väntar på dig. | Kort |
| Provision att bokföra | Genvägen Veckan, och Provision. | Ett klick |
| Sätt målen i Provision | Kortet säger när ett mål saknas. Målen sätts i Provision. | Menyraden |
| Personalen: aktiva och onboarding (`renderAeHem`) | Anställda. | Menyraden |
| Coachning (`renderCnHemChef`) | Coachning. | Menyraden |
| Dagens agenda (`renderAgenda`) | Raden under hälsningen säger hur många möten som är kvar och vilket som är nästa. Resten står i Kalendern. | Kort |
| Nyheter (`renderNews`) | Nyheter. | Menyraden |
| Nästa arbetsdag (`renderTmr`) | Genvägen Veckan. | Ett klick |
| Veckan som kommer, på söndagar (`renderWeek`) | Genvägen Veckan. | Ett klick |
| Kvällsnotisen: hur den lyder, och på eller av för enheten (`renderNotif`) | Genvägen Veckan, för den som leder. Finns också i Inställningar under Notiser. | Ett klick |

## Säljarens kort

| Det gamla hemmet | Det nya hemmet | Plats |
| --- | --- | --- |
| Provision (`renderProv`) | Kortet Din månad, med uträkningen order för order bakom ett klick. | Kort |
| Coachning (`renderCnHem`) | Coachning. | Menyraden |
| Dagens agenda (`renderAgenda`) | Raden under hälsningen, och Kalendern. | Kort |
| Din utveckling: kurserna (`renderDev`) | Utbildning. En kurs med frist är en rad i Väntar på dig. | Menyraden |
| Nyheter (`renderNews`) | Nyheter. | Menyraden |
| Din frånvaro: saldo och ansökningar (`renderFranvaro`) | Frånvaro. | Menyraden |

## Det som syns mindre i det nya hemmet

Ingenting är borttaget, men tre saker stod på hemmet förut och ligger nu bara i
sin egen vy. Beställaren avgör om någon av dem ska ha en plats på hemmet:

1. **Olästa nyheter.** Det gamla hemmet visade de tre senaste och hur många som
   var olästa. Det nya säger ingenting om nyheter.
2. **Kurser utan frist.** Din utveckling visade två kurser med hur långt du
   kommit. Det nya visar bara kurser som har en frist, som rader i Väntar på dig.
3. **Coachning.** Kortet finns bara i vyn Coachning.

## Före det gamla hemmet tas bort

- Beställaren har kört det nya hemmet själv i produktionen och sagt till.
- Listan ovan är genomgången en gång till mot koden. Det gamla hemmet kan ha
  fått nya saker sedan 2026-11-15.
- Provet `tests/nav2-hemvy.mjs` håller platserna: avsnitten "Det gamla hemmets
  saker har en plats" faller om en av dem tas bort.
