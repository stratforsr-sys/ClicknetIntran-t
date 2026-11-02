#!/usr/bin/env node
/**
 * 0275: en order utan provision, som läggs till senare (beställaren 2026-11-02).
 *
 * `provisionSenare` avgör om provisionen väntar efter en skrivning, och
 * `utanProvision` ger formuläret som `raknaFramProvision` räknar en sådan order
 * på. Båda är rena och delas av /order och Nav 2.0 (`src/lib/orderregler.ts`).
 *
 *   node --experimental-strip-types tests/provision-senare.mjs
 */
import { provisionSenare, utanProvision } from "../src/lib/orderregler.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const form = (falt) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) f.set(k, v);
  return f;
};

console.log("\nprovisionSenare: formuläret som ritar valet avgör");
ok("ritat och på: väntar", provisionSenare(form({ utan_provision_ritad: "1", utan_provision: "on" })) === true);
ok("ritat och av: väntar inte", provisionSenare(form({ utan_provision_ritad: "1" })) === false);
ok("ritat och av slår av en väntande order (provisionen läggs till)", provisionSenare(form({ utan_provision_ritad: "1" }), true) === false);
ok("ritat och på håller kvar en väntande order", provisionSenare(form({ utan_provision_ritad: "1", utan_provision: "on" }), true) === true);
ok("ett annat värde än 'on' är inget val", provisionSenare(form({ utan_provision_ritad: "1", utan_provision: "true" })) === false);

console.log("\nprovisionSenare: ett formulär som inte vet om valet");
ok("ny order utan markör: väntar inte", provisionSenare(form({})) === false);
ok("utan markör kan valet inte slås på", provisionSenare(form({ utan_provision: "on" })) === false);
ok("väntande order, inget i formuläret: väntar kvar", provisionSenare(form({}), true) === true);
ok("väntande order, väljaren men tomt fält: väntar kvar", provisionSenare(form({ provision_form: "belopp", commission_amount: "" }), true) === true);
ok("väntande order, belopp för hand: tillagd", provisionSenare(form({ provision_form: "belopp", commission_amount: "1500" }), true) === false);
ok("väntande order, procent för hand: tillagd", provisionSenare(form({ provision_form: "procent", commission_percent: "12" }), true) === false);
ok("väntande order, procent vald men beloppet ifyllt: väntar kvar", provisionSenare(form({ provision_form: "procent", commission_amount: "1500" }), true) === true);
ok("väntande order, belopp utan väljare: väntar kvar", provisionSenare(form({ commission_amount: "1500" }), true) === true);

console.log("\nutanProvision: 0 kr för hand, och resten orört");
const ut = utanProvision(form({ provision_form: "procent", commission_percent: "12", package_id: "2", fri_order: "on" }));
ok("provision_form = belopp", ut.get("provision_form") === "belopp");
ok("commission_amount = 0", ut.get("commission_amount") === "0");
ok("procentsatsen är borta", !ut.has("commission_percent"));
ok("övriga fält står kvar", ut.get("package_id") === "2" && ut.get("fri_order") === "on");
const orig = form({ provision_form: "procent", commission_percent: "12" });
utanProvision(orig);
ok("originalformuläret rörs inte", orig.get("provision_form") === "procent" && orig.get("commission_percent") === "12");

console.log(fel ? `\n\x1b[31m${fel} fel.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
