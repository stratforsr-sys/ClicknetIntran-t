# Leveranskalendern · byggpaket för Claude Code

## Så använder du det

1. Packa upp mappen i repot som `docs/leveranskalender/`. Committa den inte för sig: den följer med i pass 1:s commit, så att den inte kostar en egen Vercel-deploy.
2. Öppna repot i VS Code och starta Claude Code.
3. Klistra in allt under strecket i `BYGGPROMPT.md`.
4. Claude Code läser, skriver en plan och ställer tre frågor. Svara, godkänn planen, och låt den bygga pass 1.
5. Efter varje pass: öppna previewen i ett brett fönster (runt 1500 px) och `prototyp.html#bara-kalender` bredvid, och jämför med bilderna i `referens/`. Säg till om minsta skillnad. Dagkolumnerna får vara bredare eller smalare, allt annat ska stämma.
6. Previewen använder produktionsdatabasen. Prova inbjudningar med testkonton, inte med riktiga kollegor, så att ingen får notiser och mejl om testmöten.

## Vad som finns här

| Fil | Vad |
|---|---|
| `BYGGPROMPT.md` | Prompten du klistrar in |
| `SPEC.md` | Skärmkarta, tokens, 41 acceptanskriterier, notismatris, server actions, jobb, behörighet, texter |
| `prototyp.html` | Facit för utseende och beteende. Öppna med `#bara-kalender` |
| `datamodell.sql` | Tabellskissen |
| `referens/*.png` | 19 bilder av vyerna och flödena, kalendern 1200 px bred, ljust läge. BYGGPROMPT säger vilka som hör till vilket pass |
| `referens/stilmatt.json` | Uppmätta mått, typsnitt, färger och radier för varje del |
| `prototyp-flodesprov.cjs` | Klickskriptet som går igenom 35 flöden i prototypen |
