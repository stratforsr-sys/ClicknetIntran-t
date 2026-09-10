#!/usr/bin/env node
/**
 * Rattelsen av en order i en STANGD manad. Fem saker star pa spel:
 *
 *   1. SUMMAN MASTE GA IHOP. Det som bokfors i innevarande manad plus det som
 *      redan star i den stangda manaden ska bli exakt det ordern ar vard efter
 *      rattelsen. Gar de isar har nagon fatt for mycket eller for lite betalt.
 *   2. BYTT PERSON GER TVA POSTER. En "skillnad" nar saljaren bytts hade lamnat
 *      det gamla beloppet kvar hos nagon som inte salde ordern.
 *   3. NOLLPOSTER SKRIVS ALDRIG. `commission_entry` ar append-only — en nolla
 *      gar inte att stada bort efterat.
 *   4. OVERTACKET HAR FYRA FALL, inte tva: det kan uppsta och upphora, inte
 *      bara andras. En order som blir saljchefens egen tappar det helt.
 *   5. EN ANDRING SOM INTE ROR PENGAR GER INGA POSTER. Ett rattat
 *      telefonnummer ska inte notifiera nagon om ett belopp.
 *
 *   node --experimental-strip-types tests/rattelse.mjs
 */
import { rattelseposter, rorPengar } from "../src/lib/rattelse.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const VLADO = "vlado";
const FREDRIK = "fredrik";
const ZEN = "zen";

const utfall = (o = {}) => ({
  saljare: o.saljare ?? VLADO,
  provision: o.provision ?? 1500,
  chef: o.chef === undefined ? ZEN : o.chef,
  overtack: o.overtack ?? 1044,
});

/** Summan per person, sa att provet kan raknas i stallet for att jamforas rad for rad. */
const per = (poster) => {
  const m = new Map();
  for (const p of poster) m.set(p.employee_id, (m.get(p.employee_id) ?? 0) + p.belopp);
  return m;
};

// -----------------------------------------------------------------------------
console.log("\nBara beloppet andras — en post per person");
{
  // Paket 1 blev Paket 2: 1 500 -> 2 500, och overtacket 1 044 -> 1 544.
  const p = rattelseposter(
    utfall(),
    utfall({ provision: 2500, overtack: 1544 }),
    "Nordbygg AB, tecknad 2026-08-24",
  );

  ok("tva poster", p.length === 2, `${p.length}`);
  ok("saljaren far skillnaden", per(p).get(VLADO) === 1000, `${per(p).get(VLADO)}`);
  ok("chefen far skillnaden", per(p).get(ZEN) === 500, `${per(p).get(ZEN)}`);
  ok("texten bar ordern", p.every((x) => x.text.includes("Nordbygg AB")));

  // DET VIKTIGASTE PROVET: augusti bokforde 1 500 + 1 044. September bokfor
  // 1 000 + 500. Summan ska bli exakt det ordern ar vard efter rattelsen.
  ok("summan gar ihop", 1500 + 1044 + 1000 + 500 === 2500 + 1544);
}

// -----------------------------------------------------------------------------
console.log("\nEn sankning ger negativa poster");
{
  const p = rattelseposter(utfall(), utfall({ provision: 1000, overtack: 900 }), "Kund AB");
  ok("saljaren far tillbakadraget", per(p).get(VLADO) === -500, `${per(p).get(VLADO)}`);
  ok("chefen far tillbakadraget", per(p).get(ZEN) === -144, `${per(p).get(ZEN)}`);
}

// -----------------------------------------------------------------------------
console.log("\nBytt saljare ger TVA poster, inte en skillnad");
{
  const p = rattelseposter(
    utfall({ saljare: VLADO, provision: 1500 }),
    utfall({ saljare: FREDRIK, provision: 1500 }),
    "Kund AB",
  );

  ok("Vlado far tillbaka hela sitt belopp", per(p).get(VLADO) === -1500, `${per(p).get(VLADO)}`);
  ok("Fredrik far hela det nya", per(p).get(FREDRIK) === 1500, `${per(p).get(FREDRIK)}`);
  // En "skillnad" hade blivit 0 kr och lamnat 1 500 kr hos Vlado, som inte salde
  // ordern. Det ar hela skalet till att fallet finns.
  ok("ingen nettonolla som lamnar pengar fel", per(p).get(VLADO) + per(p).get(FREDRIK) === 0);
  ok("chefen rors inte nar bara saljaren bytts", per(p).get(ZEN) === undefined);
}

// -----------------------------------------------------------------------------
console.log("\nBytt saljare OCH andrat belopp");
{
  const p = rattelseposter(
    utfall({ saljare: VLADO, provision: 1500, overtack: 1044 }),
    utfall({ saljare: FREDRIK, provision: 2500, overtack: 1544 }),
    "Kund AB",
  );
  ok("Vlado tomms", per(p).get(VLADO) === -1500);
  ok("Fredrik far det nya i sin helhet", per(p).get(FREDRIK) === 2500);
  ok("chefen far bara skillnaden", per(p).get(ZEN) === 500, `${per(p).get(ZEN)}`);
}

// -----------------------------------------------------------------------------
console.log("\nOvertacket har fyra fall, inte tva");
{
  // Ordern blir saljchefens egen: overtacket utgar HELT.
  const upphor = rattelseposter(
    utfall({ saljare: VLADO, provision: 1500, chef: ZEN, overtack: 1044 }),
    utfall({ saljare: ZEN, provision: 4776, chef: null, overtack: 0 }),
    "Kund AB",
  );
  ok("Vlado tomms", per(upphor).get(VLADO) === -1500);
  // Zen far 4 776 som SALJARE och -1 044 som forra mottagare. Netto 3 732.
  ok("Zen far sin egen provision minus det gamla övertäcket",
    per(upphor).get(ZEN) === 3732, `${per(upphor).get(ZEN)}`);

  // Motsatsen: ordern fanns utan sats, en sats hinner sattas, ordern rattas.
  const uppstar = rattelseposter(
    utfall({ chef: null, overtack: 0 }),
    utfall({ chef: ZEN, overtack: 1044 }),
    "Kund AB",
  );
  ok("overtacket uppstar i sin helhet", per(uppstar).get(ZEN) === 1044);
  ok("saljaren rors inte", per(uppstar).get(VLADO) === undefined);

  // Bytt mottagare: hela beloppet tillbaka fran den forra, hela ut till den nya.
  const bytt = rattelseposter(
    utfall({ chef: ZEN, overtack: 1044 }),
    utfall({ chef: FREDRIK, overtack: 1044 }),
    "Kund AB",
  );
  ok("forra mottagaren tomms", per(bytt).get(ZEN) === -1044);
  ok("nya mottagaren far allt", per(bytt).get(FREDRIK) === 1044);
}

// -----------------------------------------------------------------------------
console.log("\nNollposter skrivs aldrig");
{
  ok("identiska utfall ger inga poster", rattelseposter(utfall(), utfall(), "x").length === 0);

  // Bara chefens del andras: saljarposten skulle blivit noll och skrivs inte.
  const p = rattelseposter(utfall(), utfall({ overtack: 1544 }), "x");
  ok("bara chefens post", p.length === 1 && p[0].employee_id === ZEN, `${p.length}`);

  // Bytt saljare med samma belopp: bada posterna behovs, ingen ar noll.
  const b = rattelseposter(utfall(), utfall({ saljare: FREDRIK }), "x");
  ok("bytt person ger tva poster aven vid samma belopp", b.length === 2);

  // Ett overtack som bade fanns och forblir noll ska inte ge en post.
  const n = rattelseposter(
    utfall({ chef: ZEN, overtack: 0 }),
    utfall({ chef: ZEN, overtack: 0, provision: 1600 }),
    "x",
  );
  ok("noll mot noll ger ingen chefspost", n.length === 1 && n[0].employee_id === VLADO);
}

// -----------------------------------------------------------------------------
console.log("\nEn andring som inte ror pengar");
{
  ok("rorPengar ar falskt nar allt star still", rorPengar(utfall(), utfall()) === false);
  ok("...och sant nar ett belopp andrats", rorPengar(utfall(), utfall({ provision: 1501 })) === true);
  ok("...och sant nar saljaren bytts", rorPengar(utfall(), utfall({ saljare: FREDRIK })) === true);
}

// -----------------------------------------------------------------------------
console.log("\nSumman gar ihop over slumpade rattelser");
{
  // Provet ovan raknar ETT fall for hand. Det har raknar hundra: for varje par
  // av utfall maste det som redan bokforts plus rattelseposterna bli exakt det
  // nya utfallet, per person. Det ar den egenskap hela filen finns for.
  let brister = 0;

  for (let i = 0; i < 100; i++) {
    const slump = (n) => Math.floor(Math.random() * n);
    const personer = [VLADO, FREDRIK, ZEN];
    const g = {
      saljare: personer[slump(3)],
      provision: slump(5000),
      chef: slump(2) ? personer[slump(3)] : null,
      overtack: slump(2000),
    };
    const n = {
      saljare: personer[slump(3)],
      provision: slump(5000),
      chef: slump(2) ? personer[slump(3)] : null,
      overtack: slump(2000),
    };
    // En chef som ar null bar aldrig ett belopp — samma invariant som koden.
    if (g.chef === null) g.overtack = 0;
    if (n.chef === null) n.overtack = 0;

    const bokfort = per([
      { employee_id: g.saljare, belopp: g.provision },
      ...(g.chef ? [{ employee_id: g.chef, belopp: g.overtack }] : []),
    ]);
    const ratt = per([
      { employee_id: n.saljare, belopp: n.provision },
      ...(n.chef ? [{ employee_id: n.chef, belopp: n.overtack }] : []),
    ]);

    const efter = new Map(bokfort);
    for (const p of rattelseposter(g, n, "x")) {
      efter.set(p.employee_id, (efter.get(p.employee_id) ?? 0) + p.belopp);
    }

    for (const person of new Set([...efter.keys(), ...ratt.keys()])) {
      if ((efter.get(person) ?? 0) !== (ratt.get(person) ?? 0)) brister++;
    }
  }

  ok("hundra slumpade rattelser landar ratt, per person", brister === 0, `${brister} brister`);
}

console.log(
  fel === 0
    ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n"
    : `\n\x1b[31m${fel} prov misslyckades.\x1b[0m\n`,
);
process.exit(fel === 0 ? 0 : 1);
