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

import { GUIDER, guiderForRoller, hamtaGuide, startguiden } from "../src/guider/index.ts";
import { NAV_PREFIX } from "../src/guider/ankare.ts";
import {
  arKlar,
  behoverOmtag,
  guideLage,
  procent,
  sparvarde,
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

/** Alla .tsx-filer under src/, som text. Det är där attributen kan sitta. */
function granssnittet(katalog = join(rot, "src")) {
  const ut = [];
  for (const namn of readdirSync(katalog)) {
    const p = join(katalog, namn);
    if (statSync(p).isDirectory()) ut.push(...granssnittet(p));
    else if (namn.endsWith(".tsx")) ut.push(readFileSync(p, "utf8"));
  }
  return ut;
}

const KALLKOD = granssnittet();

/** Ankaren som faktiskt står utskrivna i gränssnittet. */
const UTSKRIVNA = new Set();
for (const fil of KALLKOD) {
  for (const traff of fil.matchAll(/data-guide="([^"]+)"/g)) {
    // Overlayen bygger sina egna väljare — `[data-guide="${ankare}"]` — och de
    // är inte utskrivna attribut. Utan undantaget rapporteras de som ett ankare
    // vid namn "${ankare}" som ingen guide använder.
    if (traff[1].includes("${")) continue;
    UTSKRIVNA.add(traff[1]);
  }
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
  const navItems = las("src/components/shell/nav-items.ts");
  const sidebar = las("src/components/shell/Sidebar.tsx");

  // Menyposternas ankare byggs av en funktion — de kan inte stå utskrivna, för
  // menyn ser olika ut för varje roll. Se src/guider/ankare.ts.
  ok("sidopanelen märker sina poster", sidebar.includes("data-guide={navAnkare(item.href)}"));

  for (const guide of GUIDER) {
    for (const [nr, steg] of guide.steg.entries()) {
      // Samma ankare i båda fälten ska inte provas två gånger.
      for (const ankare of new Set([steg.ankare, steg.ankare_mobil])) {
        if (!ankare) continue;

        if (ankare.startsWith(NAV_PREFIX)) {
          const href = ankare.slice(NAV_PREFIX.length);
          ok(
            `${guide.slug} steg ${nr + 1}: menyposten ${href} finns`,
            navItems.includes(`href: "${href}"`),
          );
          continue;
        }

        ok(`${guide.slug} steg ${nr + 1}: ${ankare}`, UTSKRIVNA.has(ankare));
      }
    }
  }

  // Inte ett fel, men värt att veta: ett attribut ingen guide pekar på är kod
  // som ingen underhåller och som nästa person tror används.
  const anvanda = new Set();
  for (const g of GUIDER) for (const s of g.steg) {
    if (s.ankare) anvanda.add(s.ankare);
    if (s.ankare_mobil) anvanda.add(s.ankare_mobil);
  }
  const oanvanda = [...UTSKRIVNA].filter((a) => !anvanda.has(a));
  if (oanvanda.length) console.log(`    \x1b[33m·\x1b[0m ankare utan guide: ${oanvanda.join(" ")}`);
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

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
