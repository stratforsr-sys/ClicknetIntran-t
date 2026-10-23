#!/usr/bin/env node
/**
 * Kalendern: vad i ett möte som ändrats när formuläret sparas (granskningen E2).
 *
 *   TZ=UTC node --experimental-strip-types tests/kalender-andring.mjs
 *
 * `andradeDelar` avgör om något skickas alls. Ett "Spara" utan ändring
 * mejlade förut alla deltagare och skickade kunden "Ny tid … Vi har flyttat
 * mötet". Mängden styr vad lk_spara_mote (0212) gör: tid och plats ger ett
 * besked till alla och en ny .ics, rubrik och agenda bara en tyst notis, och
 * påminnelse, Visa som, Privat och valfria ingenting till någon.
 */
import { andradeDelar, motesBesked, ombudetsFalt } from "../src/lib/nav2/kalender-andring.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const lika = (m, lista) => [...m].sort().join() === [...lista].sort().join();

const mote = {
  dag: "2026-11-12",
  tid: "09:00",
  minuter: 30,
  title: "Avstämning",
  plats: "Kontoret",
  online_url: null,
  agenda: "Punkt 1",
  deltagare: ["a", "b"],
  valfria: [],
  reminder_min: 60,
  reminder_off: false,
  show_as: "upptagen",
  is_private: false,
};

rubrik("Ingenting ändrat");
ok("samma möte före och efter ger en tom mängd", andradeDelar(mote, { ...mote }).size === 0);
ok("deltagarna i en annan ordning är ingen ändring", andradeDelar(mote, { ...mote, deltagare: ["b", "a"] }).size === 0);
ok("tid med sekunder från databasen är samma tid", andradeDelar({ ...mote, tid: "09:00:00" }, mote).size === 0);
ok("tom plats och null är samma", andradeDelar({ ...mote, plats: null }, { ...mote, plats: "" }).size === 0);
ok("blanksteg runt rubriken är ingen ändring", andradeDelar(mote, { ...mote, title: " Avstämning " }).size === 0);

rubrik("En sak i taget");
ok("ändrad agenda ger {innehall}", lika(andradeDelar(mote, { ...mote, agenda: "Punkt 2" }), ["innehall"]));
ok("ändrad rubrik ger {innehall}", lika(andradeDelar(mote, { ...mote, title: "Ny" }), ["innehall"]));
ok("ny tid och ny längd ger {tid}", lika(andradeDelar(mote, { ...mote, tid: "10:00", minuter: 45 }), ["tid"]));
ok("ny dag ger {tid}", lika(andradeDelar(mote, { ...mote, dag: "2026-11-13" }), ["tid"]));
ok("en ny deltagare ger {deltagare}", lika(andradeDelar(mote, { ...mote, deltagare: ["a", "b", "c"] }), ["deltagare"]));
ok("en borttagen deltagare ger {deltagare}", lika(andradeDelar(mote, { ...mote, deltagare: ["a"] }), ["deltagare"]));
ok("ny plats ger {plats}", lika(andradeDelar(mote, { ...mote, plats: "Telefon" }), ["plats"]));
ok("ny länk ger {plats}", lika(andradeDelar(mote, { ...mote, online_url: "https://meet.example/x" }), ["plats"]));
ok("valfri ger {valfria}", lika(andradeDelar(mote, { ...mote, valfria: ["b"] }), ["valfria"]));
ok("påminnelsen ger {paminnelse}", lika(andradeDelar(mote, { ...mote, reminder_min: 15 }), ["paminnelse"]));
ok("Ingen påminnelse ger {paminnelse}", lika(andradeDelar(mote, { ...mote, reminder_off: true }), ["paminnelse"]));
ok("Visa som ger {visa}", lika(andradeDelar(mote, { ...mote, show_as: "ledig" }), ["visa"]));
ok("Privat ger {privat}", lika(andradeDelar(mote, { ...mote, is_private: true }), ["privat"]));
ok("allt på en gång ger alla åtta", andradeDelar(mote, { ...mote, tid: "10:00", plats: "X", agenda: "Y", deltagare: ["a"], valfria: ["a"], reminder_min: 5, show_as: "borta", is_private: true }).size === 8);

rubrik("Vad som skickas (samma regel som lk_spara_mote)");
const b = (d) => motesBesked(new Set(d));
ok("ingenting: inget besked, ingen .ics", b([]).kvarvarande === null && !b([]).ics);
ok("bara agenda: tyst notis, ingen .ics", b(["innehall"]).kvarvarande === "kalender-flyttad-tyst" && !b(["innehall"]).ics);
ok("tid: besked till alla och .ics", b(["tid"]).kvarvarande === "kalender-flyttad" && b(["tid"]).ics);
ok("plats: besked till alla och .ics", b(["plats"]).kvarvarande === "kalender-flyttad" && b(["plats"]).ics);
ok("tid och agenda: ett besked, inte två", b(["tid", "innehall"]).kvarvarande === "kalender-flyttad");
ok("påminnelse, Visa som, Privat, valfria: inget till någon", ["paminnelse", "visa", "privat", "valfria"].every((d) => b([d]).kvarvarande === null && !b([d]).ics));
ok("bara deltagare: inget till dem som var med förut", b(["deltagare"]).kvarvarande === null && !b(["deltagare"]).ics);

rubrik("Ombudet (0201) ser inte allt arrangören ser");
ok("arrangören: länken som skickats gäller", JSON.stringify(ombudetsFalt({ arrangor: true, privat: false, deltar: false, video: null })) === JSON.stringify({ video: null }));
ok("ombud som inte är med: en tom länk betyder oförändrad (hen fick aldrig se den)", "video" in ombudetsFalt({ arrangor: false, privat: false, deltar: false, video: null }) && ombudetsFalt({ arrangor: false, privat: false, deltar: false, video: null }).video === undefined);
ok("ombud som inte är med: en ny länk gäller", ombudetsFalt({ arrangor: false, privat: false, deltar: false, video: "https://x.example/m" }).video === "https://x.example/m");
ok("ombud som är med: tom länk tar bort den (hen såg den)", ombudetsFalt({ arrangor: false, privat: false, deltar: true, video: null }).video === null);
ok("ombud, privat möte hen inte är med på: nej (formuläret visade Privat, inga deltagare)", "fel" in ombudetsFalt({ arrangor: false, privat: true, deltar: false, video: undefined }));
ok("ombud, privat möte hen är med på: går", !("fel" in ombudetsFalt({ arrangor: false, privat: true, deltar: true, video: undefined })));

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
