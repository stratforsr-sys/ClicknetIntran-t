#!/usr/bin/env node
/**
 * Att guiderna pekar på något som finns — och att en påbörjad tur överlever att
 * personen byter från telefon till dator.
 *
 * ===========================================================================
 * PROVET HAR TVÅ HALVOR, OCH DEN FÖRSTA ÄR DEN SOM MOTIVERAR HELA BYGGET.
 *
 * En guidad tur pekar på element i det riktiga gränssnittet via `data-guide`.
 * Den kopplingen är osynlig för TypeScript: byter någon namn på ett attribut
 * i Sidebar.tsx kompilerar allt, alla andra prov är gröna, och felet visar sig
 * först för en ny anställd som får en ruta som pekar på tom luft under sin
 * första kvart i navet. Det är den sämsta tänkbara upptäckaren.
 *
 * Därför läser den första halvan källkoden och kräver att varje ankare någon
 * guide använder finns i en .tsx-fil. Kontrollen är trubbig — den vet inte OM
 * attributet sitter på rätt element — men den kan inte luras av att det
 * försvinner, och det var det som skulle fångas.
 *
 * Andra halvan prövar reglerna i src/lib/guider.ts, och särskilt den enda som
 * är svår att se med ögat: att progressen räknas i den fullständiga steglistan
 * och inte i den synliga. Se rubriken i den filen.
 * ===========================================================================
 *
 *   node --experimental-strip-types tests/guider.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  GUIDER,
  guideForModul,
  guiderForRoller,
  hamtaGuide,
  startguiden,
} from "../src/guider/index.ts";
import {
  FRIST_DAGAR,
  STILLASTAENDE_DAGAR,
  arKlar,
  behoverOmtag,
  dagarSedan,
  guideLage,
  personlage,
  procent,
  sparvarde,
  starStilla,
  startSteg,
  synligaSteg,
} from "../src/lib/guider.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const rot = fileURLToPath(new URL("../", import.meta.url));
const las = (sokvag) => readFileSync(join(rot, sokvag), "utf8");

/**
 * Nav 2.0 (2026-10-20): turerna pekar på utkastets HTML, `src/nav2/utkast.html`,
 * med CSS-väljare (se src/guider/nav2.ts). Utkastets utseende ändras inte, så
 * väljarna är det som redan står i sidan: id, klasser och data-attribut. En del
 * ritas av skriptet i samma fil, och därför letar provet i hela filen.
 */
const UTKAST = las("src/nav2/utkast.html");

/** Varje del av en väljare (#id, .klass, [attribut="värde"]) ska stå i utkastet. */
function valjarenFinns(valjare) {
  const delar = [
    ...[...valjare.matchAll(/#([\w-]+)/g)].map((m) => m[1]),
    ...[...valjare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    ...[...valjare.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].flatMap((m) => (m[2] ? [m[1], m[2]] : [m[1]])),
  ];
  return delar.length > 0 && delar.every((d) => UTKAST.includes(d));
}

console.log("\n\x1b[1mRegistret\x1b[0m");
{
  const slugar = GUIDER.map((g) => g.slug);
  ok("varje slug är unik", new Set(slugar).size === slugar.length, slugar.join(" "));
  ok("uppslag på slug träffar", GUIDER.every((g) => hamtaGuide(g.slug) === g));
  ok("okänd slug ger null", hamtaGuide("finns-inte") === null);

  // Två guider som båda vill äga första inloggningen är inte en inställning
  // utan ett misstag, och `startguiden()` skulle tyst välja den första.
  const auto = GUIDER.filter((g) => g.vidForstaInloggningen);
  ok("exakt en guide startar av sig själv", auto.length === 1, auto.map((g) => g.slug).join(" "));
  ok("och det är den startguiden() svarar", startguiden() === auto[0]);

  // Tom rollista = alla. Startguiden måste ha det, annars finns det roller som
  // aldrig blir onboardade.
  ok("startguiden gäller alla roller", startguiden()?.roller.length === 0);
  ok(
    "en säljare får startguiden",
    guiderForRoller(["salesperson"]).some((g) => g.slug === startguiden()?.slug),
  );
  ok("ett konto utan roller får den också", guiderForRoller([]).length >= 1);
  ok("null som rollista kraschar inte", guiderForRoller(null).length >= 1);

  // `krav: "stamplar"` kan inte uttryckas som en rollista — se typer.ts. Svaret
  // kommer utifrån, och guiden ska försvinna helt när det är nej.
  const kravsguider = GUIDER.filter((g) => g.krav === "stamplar");
  ok("det finns en guide som kräver att man stämplar", kravsguider.length >= 1);
  for (const g of kravsguider) {
    ok(
      `${g.slug}: göms för den som inte stämplar`,
      !guiderForRoller(["salesperson"], { stamplar: false }).includes(g),
    );
    ok(
      `${g.slug}: visas för den som stämplar`,
      guiderForRoller(["salesperson"], { stamplar: true }).includes(g),
    );
  }

  /**
   * Behörighetsguiderna. `payroll_cost_viewer` är den skarpa: den delas ut per
   * person och inte med en roll, och en guide som skyltade i listan för varje
   * ekonom hade lovat en vy de inte kommer in i.
   */
  const behorighetsguider = GUIDER.filter((g) => g.behorighet);
  ok("det finns minst en behörighetsstyrd guide", behorighetsguider.length >= 1);
  for (const g of behorighetsguider) {
    ok(
      `${g.slug}: göms utan behörigheten`,
      !guiderForRoller(["finance", "ceo"], { behorigheter: [] }).includes(g),
    );
    ok(
      `${g.slug}: visas med den`,
      guiderForRoller(["finance"], { behorigheter: [g.behorighet] }).includes(g),
    );
  }

  // En roll som inte är säljare ska inte få säljarens guider.
  const ekonomi = guiderForRoller(["finance"]).map((g) => g.slug);
  ok("ekonomi får inte stämplingsguiden", !ekonomi.includes("stampla-in-och-ut"));
  ok("men får de som gäller alla", ekonomi.includes("rutiner-och-kvittens"));

  const projektledare = guiderForRoller(["project_manager"]).map((g) => g.slug);
  ok("projektledare får inte orderguiden", !projektledare.includes("registrera-order"));
  ok("projektledare får inte personalguiden", !projektledare.includes("personal-och-anstallning"));

  // Utan villkor alls ska ingenting krascha, och de som gäller alla ska komma med.
  const alla = guiderForRoller([]).map((g) => g.slug);
  ok("ett konto utan roller får de öppna guiderna", alla.includes("nyheter") && alla.includes("avtal"));
  ok("men ingen av ledningens", !alla.includes("lonerapport") && !alla.includes("avvikelser"));
}

console.log("\n\x1b[1mVarje guide går att starta\x1b[0m");
{
  /**
   * Varje tur går att starta från Utbildning → Biblioteket → Lär dig Nav, så
   * `modul` är inte längre nödvändig. Den som finns är en vy i Nav 2.0, där
   * turen startar av sig själv första gången vyn öppnas.
   */
  const moduler = GUIDER.filter((g) => g.modul).map((g) => g.modul);
  ok("en modul har högst en guide", new Set(moduler).size === moduler.length, moduler.join(" "));
  for (const m of moduler) ok(`uppslag på ${m} träffar`, guideForModul(m)?.modul === m);
  for (const m of moduler) {
    ok(`${m} är en vy i Nav 2.0`, UTKAST.includes(`data-go="${m}"`) || UTKAST.includes(`data-view="${m.slice(1)}"`));
  }
}

console.log("\n\x1b[1mVarje guide håller formen\x1b[0m");
for (const guide of GUIDER) {
  ok(`${guide.slug}: har steg`, guide.steg.length > 0);
  ok(`${guide.slug}: version minst 1`, Number.isInteger(guide.version) && guide.version >= 1);
  ok(`${guide.slug}: har en tid att lova`, guide.minuter > 0);
  ok(
    `${guide.slug}: varje steg har rubrik och text`,
    guide.steg.every((s) => s.rubrik?.trim() && s.text?.trim()),
  );
  ok(
    `${guide.slug}: bara giltiga lägen`,
    guide.steg.every((s) => !s.bara || s.bara === "dator" || s.bara === "mobil"),
  );

  /**
   * Ett steg som KRÄVER en handling måste ha något att kräva den på. Utan
   * ankare finns ingen knapp att trycka på, ingen lyssnare att sätta — och
   * eftersom sådana steg med flit saknar Nästa-knapp blir resultatet en tur
   * som inte går att avsluta.
   */
  ok(
    `${guide.slug}: handling kräver ankare`,
    guide.steg.every((s) => s.handling === "vidare" || s.ankare || s.ankare_mobil),
  );
}

console.log("\n\x1b[1mAnkaren finns i gränssnittet\x1b[0m");
{
  for (const guide of GUIDER) {
    for (const [nr, steg] of guide.steg.entries()) {
      for (const ankare of new Set([steg.ankare, steg.ankare_mobil])) {
        if (!ankare) continue;
        // En lista med kommatecken betyder "den första som syns": minst ett alternativ ska finnas.
        const alternativ = ankare.split(",").map((a) => a.trim());
        ok(`${guide.slug} steg ${nr + 1}: ${ankare}`, alternativ.some(valjarenFinns));
      }
    }
  }
}

console.log("\n\x1b[1mBåda lägena ger en spelbar tur\x1b[0m");
for (const guide of GUIDER) {
  const dator = synligaSteg(guide, "dator");
  const mobil = synligaSteg(guide, "mobil");

  ok(`${guide.slug}: går att köra på dator`, dator.length > 0, `${dator.length} steg`);
  ok(`${guide.slug}: går att köra på telefon`, mobil.length > 0, `${mobil.length} steg`);

  // Ett steg som bara finns i ett läge får inte vara det första eller sista:
  // välkomsten och avslutet är turens ramar och måste finnas för alla.
  ok(`${guide.slug}: första steget finns i båda lägena`, !guide.steg[0].bara);
  ok(`${guide.slug}: sista steget finns i båda lägena`, !guide.steg[guide.steg.length - 1].bara);
}

console.log("\n\x1b[1mProgressen överlever ett byte av skärm\x1b[0m");
{
  /**
   * Det här är provets skäl att finnas näst efter ankarna.
   *
   * `steg` i databasen räknas i den FULLSTÄNDIGA listan just för att den
   * synliga listan är olika på en telefon och en dator. Räknade vi i den
   * synliga skulle den som börjar på bussen och fortsätter vid skrivbordet
   * hoppa över ett steg — eller få ett i repris.
   *
   * Kontrollen: gå igenom turen steg för steg i det ena läget, och kräv att
   * uppslaget i det ANDRA läget alltid landar på det första steg som inte
   * hunnits med. Varken tidigare (repris) eller senare (överhoppat).
   */
  for (const guide of GUIDER) {
    for (const [fran, till] of [["mobil", "dator"], ["dator", "mobil"]]) {
      const franSteg = synligaSteg(guide, fran);
      const tillSteg = synligaSteg(guide, till);
      let alltRatt = true;
      let forsta = "";

      for (let p = 0; p < franSteg.length; p++) {
        const sparat = sparvarde(guide, fran, p);
        const nyPosition = startSteg(guide, till, sparat);

        // Det första steg i mållistan som ännu inte är avklarat.
        const vantat = tillSteg.findIndex(({ full }) => full >= sparat);
        const vantatKlamt = vantat === -1 ? tillSteg.length - 1 : vantat;

        if (nyPosition !== vantatKlamt) {
          alltRatt = false;
          if (!forsta) forsta = `efter ${p + 1} steg: fick ${nyPosition}, väntade ${vantatKlamt}`;
        }
      }

      ok(`${guide.slug}: ${fran} → ${till}`, alltRatt, forsta);
    }
  }

  // Och den naiva varianten SKULLE ha felat på startguiden — annars vaktar
  // provet ingenting.
  const g = startguiden();
  const mobil = synligaSteg(g, "mobil");
  const dator = synligaSteg(g, "dator");
  const skiljerSig = mobil.some((s, i) => dator[i] && dator[i].full !== s.full);
  ok(
    "startguidens listor skiljer sig åt mellan lägena",
    skiljerSig,
    "annars provar kontrollen ovan ingenting",
  );
}

console.log("\n\x1b[1mAtt återuppta en tur\x1b[0m");
{
  const g = startguiden();
  const antal = synligaSteg(g, "dator").length;

  ok("utan sparat värde börjar man om", startSteg(g, "dator", null) === 0);
  ok("noll är också början", startSteg(g, "dator", 0) === 0);

  // Ett tal som pekar förbi slutet får inte kasta. En guide som krympt lämnar
  // rader kvar som gör just det — se 0040 och startSteg().
  ok("förbi slutet ger sista steget", startSteg(g, "dator", 9999) === antal - 1);
  ok("negativt tal ger början", startSteg(g, "dator", -5) === 0);
  ok("odefinierat ger början", startSteg(g, "dator", undefined) === 0);
}

console.log("\n\x1b[1mKlar, och klar nog\x1b[0m");
{
  const g = startguiden();
  const rad = (over) => ({ guide_slug: g.slug, version: 1, steg: 0, completed_at: null, ...over });

  ok("ingen rad är inte klar", arKlar(g, null) === false);
  ok("påbörjad är inte klar", arKlar(g, rad({ steg: 3 })) === false);
  ok("avslutad är klar", arKlar(g, rad({ steg: 11, completed_at: "2026-08-31T10:00:00Z" })));

  // En textputs får inte be hela personalen göra om turen. Bara `omtag` gör
  // ett gammalt genomförande ogiltigt — se typer.ts.
  const utanOmtag = { ...g, version: 2 };
  ok(
    "höjd version utan omtag rör inte den som är klar",
    arKlar(utanOmtag, rad({ version: 1, completed_at: "2026-08-31T10:00:00Z" })),
  );

  const medOmtag = { ...g, version: 2, omtag: true };
  const gammal = rad({ version: 1, completed_at: "2026-08-31T10:00:00Z" });
  ok("omtag gör gammalt genomförande ogiltigt", arKlar(medOmtag, gammal) === false);
  ok("och läget säger att det ska göras om", guideLage(medOmtag, gammal) === "omtag");
  ok("behoverOmtag håller med", behoverOmtag(medOmtag, gammal));
  ok(
    "den som gjort nya versionen är klar",
    arKlar(medOmtag, rad({ version: 2, completed_at: "2026-08-31T10:00:00Z" })),
  );

  ok("orörd guide är ej påbörjad", guideLage(g, null) === "ej_paborjad");
  ok("påbörjad guide pågår", guideLage(g, rad({ steg: 2 })) === "pagar");
  ok("avslutad guide är klar", guideLage(g, rad({ steg: 11, completed_at: "x" })) === "klar");

  ok("procent för orörd är 0", procent(g, null) === 0);
  ok("procent för klar är 100", procent(g, rad({ steg: 11, completed_at: "x" })) === 100);
  ok("procent mitt i ligger emellan", procent(g, rad({ steg: 5 })) > 0 && procent(g, rad({ steg: 5 })) < 100);
}

console.log("\n\x1b[1mChefens vy: hur långt någon kommit\x1b[0m");
{
  const NU = new Date("2026-09-01T12:00:00Z");
  const dagarSen = (d) => new Date(NU.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
  const datum = (d) => dagarSen(d).slice(0, 10);

  const paket = guiderForRoller(["salesperson"], { stamplar: true });
  ok("säljarens paket är flera guider", paket.length >= 5, `${paket.length} st`);

  const klarRad = (g, nar) => ({
    guide_slug: g.slug,
    version: g.version,
    steg: g.steg.length,
    completed_at: dagarSen(nar),
    updated_at: dagarSen(nar),
  });

  // Ingen har rört någonting.
  {
    const l = personlage(paket, [], datum(2), NU);
    ok("orörd: noll klara", l.klara === 0 && l.av === paket.filter((g) => !g.frivillig).length);
    ok("orörd: ingenting pågår", l.pagar === null);
    ok("orörd: inte onboardad", l.onboardad === false);
    ok("orörd: stillestånd är null, inte noll", l.stillestand === null);
    ok("orörd: markeras inte som stillastående", starStilla(l) === false);
  }

  /**
   * Den som inte börjat står inte still — hon har inte börjat. Skillnaden är
   * hela skälet att `stillestand` är null och inte ett tal: ett larm om något
   * ingen ännu haft chansen att göra fel på är brus, och brus i chefens vy är
   * det som gör att raden som betyder något inte läses.
   */
  {
    const l = personlage(paket, [], datum(30), NU);
    ok("aldrig påbörjad efter 30 dagar står ändå inte still", starStilla(l) === false);
    ok("men den är försenad", l.forsenad === true);
  }

  // Mitt i en tur.
  {
    const rader = [
      klarRad(paket[0], 5),
      { guide_slug: paket[1].slug, version: paket[1].version, steg: 2, completed_at: null, updated_at: dagarSen(4) },
    ];
    const l = personlage(paket, rader, datum(6), NU);
    ok("pågående: en klar", l.klara === 1);
    ok("pågående: rätt tur pekas ut", l.pagar?.slug === paket[1].slug, l.pagar?.titel ?? "—");
    ok("pågående: rätt steg", l.pagar?.steg === 2 && l.pagar?.av === paket[1].steg.length);
    ok(`pågående: stillestånd ${STILLASTAENDE_DAGAR}+ dagar markeras`, starStilla(l) === true);
    ok("pågående: inte onboardad", l.onboardad === false);
  }

  // Rörelse i dag räknas, även i en annan guide än den som pågår.
  {
    const rader = [
      klarRad(paket[0], 0),
      { guide_slug: paket[1].slug, version: paket[1].version, steg: 1, completed_at: null, updated_at: dagarSen(9) },
    ];
    const l = personlage(paket, rader, datum(9), NU);
    ok("senaste rörelsen i NÅGON guide räknas", l.stillestand === 0);
    ok("och då står hon inte still", starStilla(l) === false);
  }

  // Allt klart.
  {
    const rader = paket.map((g) => klarRad(g, 1));
    const l = personlage(paket, rader, datum(20), NU);
    ok("allt klart: onboardad", l.onboardad === true);
    ok("allt klart: räknas inte som försenad", l.forsenad === false);
    ok("allt klart: markeras inte", starStilla(l) === false);
  }

  // Frivilliga turer (Nav 2.0:s nya, tills beställaren sagt annat) räknas inte.
  {
    const frivilliga = paket.filter((g) => g.frivillig);
    ok("det finns frivilliga turer i säljarens paket", frivilliga.length >= 1);
    const rader = paket.filter((g) => !g.frivillig).map((g) => klarRad(g, 1));
    ok("utan de frivilliga: onboardad", personlage(paket, rader, datum(20), NU).onboardad === true);
  }

  // Fristen.
  {
    const inom = personlage(paket, [], datum(FRIST_DAGAR - 1), NU);
    const utanfor = personlage(paket, [], datum(FRIST_DAGAR + 1), NU);
    ok(`inom ${FRIST_DAGAR} dagar är ingen försenad`, inom.forsenad === false);
    ok(`efter ${FRIST_DAGAR} dagar är hon det`, utanfor.forsenad === true);
    ok("utan startdatum går det inte att vara försenad", personlage(paket, [], null, NU).forsenad === false);
  }

  // En höjd version med omtag gör en onboardad person icke-klar igen. Det är
  // avsiktligt: annars vore omtaget bara en text i en lista.
  {
    const g0 = { ...paket[0], version: paket[0].version + 1, omtag: true };
    const paket2 = [g0, ...paket.slice(1)];
    const rader = paket.map((g) => klarRad(g, 1));
    ok("omtag återöppnar paketet", personlage(paket2, rader, datum(3), NU).onboardad === false);
  }

  ok("dagarSedan på null är null", dagarSedan(null, NU) === null);
  ok("dagarSedan på skräp är null", dagarSedan("inte ett datum", NU) === null);
  ok("dagarSedan räknar hela dygn", dagarSedan(dagarSen(3), NU) === 3);
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
