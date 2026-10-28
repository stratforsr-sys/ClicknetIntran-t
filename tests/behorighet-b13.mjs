// Granskningen S16 (B13, beställaren 2026-10-23): raderna i behörighetskortet som
// var märkta "förslag" är bara Superadmins, på servern och i gamla Nav. Och V4:
// en rutins bilaga tas bara bort om filen hör till rutinen.
//
// Statiskt prov: varje väg läses ur källan och ska pröva Superadmin före sin verkan.
// Kör: TZ=UTC node --experimental-strip-types tests/behorighet-b13.mjs [rot]
import { readFileSync } from "node:fs";
import path from "node:path";

const ROT = process.argv[2] ?? process.cwd();
const las = (f) => {
  try {
    return readFileSync(path.join(ROT, f), "utf8");
  } catch {
    return "";
  }
};
let fel = 0;
const ok = (namn, villkor) => {
  console.log(`${villkor ? "✓" : "✗"} ${namn}`);
  if (!villkor) fel++;
};
// Kroppen för en exporterad funktion eller ett case, fram till nästa på samma nivå.
const kropp = (s, start) => {
  const i = s.indexOf(start);
  if (i < 0) return "";
  const j = s.slice(i + start.length).search(/\nexport (async )?function |\n {6}case "/);
  return j < 0 ? s.slice(i) : s.slice(i, i + start.length + j);
};
const fore = (s, vakt, verkan) => s.indexOf(vakt) >= 0 && s.indexOf(verkan) > s.indexOf(vakt);

// Superadmin är samma regel i gamla Nav som i Nav 2.0.
const auth = las("src/lib/auth.ts");
const sa = kropp(auth, "export function arSuperadmin");
ok("arSuperadmin = VD eller administratör", /hasRole\(user, "ceo", "admin"\)/.test(sa));
const forma = las("src/lib/nav2/forma.ts");
const superFran = [...forma.matchAll(/^\s+(\w+): "superadmin",$/gm)].map((m) => m[1]).sort().join(",");
ok("nivaFor ger superadmin för exakt ceo och admin", superFran === "admin,ceo");

// Regler som gäller alla.
const pr = las("src/app/(app)/provision/regler/actions.ts");
ok("provisionsreglerna: kravRegelagare prövar Superadmin", /async function kravRegelagare\(\)[\s\S]{0,200}arSuperadmin\(user\)/.test(pr));
for (const f of ["sparaNiva", "stangNiva", "sparaChefssats", "sparaKonsekvenssteg", "taBortKonsekvenssteg"]) {
  ok(`provisionsreglerna: ${f} går genom kravRegelagare`, kropp(pr, `export async function ${f}(`).includes("await kravRegelagare()"));
}
const pv2 = las("src/app/nav2/provision/route.ts");
for (const c of ["trappa-bort", "chefssats-bort"]) {
  ok(`/nav2/provision ${c} prövar Superadmin före raderingen`, fore(kropp(pv2, `case "${c}"`), 'nivaFor(user.roles) !== "superadmin"', ".delete()"));
}
const kv = las("src/app/(app)/kv/regler/actions.ts");
ok("K&V-reglerna: kravRegelagare prövar Superadmin", /async function kravRegelagare\(\)[\s\S]{0,200}arSuperadmin\(user\)/.test(kv));
for (const f of ["sparaOmrade", "sparaRegler"]) ok(`K&V-reglerna: ${f} går genom kravRegelagare`, kropp(kv, `export async function ${f}(`).includes("await kravRegelagare()"));
const fr = las("src/app/(app)/franvaro/regler/actions.ts");
ok("frånvaroreglerna: farAndra är Superadmin", /function farAndra\([^)]*\): boolean \{\s*return arSuperadmin\(user\);/.test(fr));
for (const f of ["sparaTyp", "sparaPolicy", "sparaSparrperiod", "sparaTak", "sparaRingordning"]) {
  ok(`frånvaroreglerna: ${f} prövar farAndra`, kropp(fr, `export async function ${f}(`).includes("if (!farAndra(user))"));
}
const tid = las("src/app/(app)/tid/actions.ts");
for (const [f, tabell] of [["sparaArbetsschema", "work_schedule"], ["sparaRastschema", "scheduled_break"]]) {
  ok(`scheman: ${f} kräver Superadmin för bolag och team före skrivningen`, fore(kropp(tid, `export async function ${f}(`), 'if (scope !== "employee" && !arSuperadmin(user))', `from("${tabell}")`));
}

// Det som inte går att ångra.
const st = las("src/app/(app)/provision/stangning.ts");
ok("fastställa: faststallPeriod prövar Superadmin före perioden skrivs", fore(kropp(st, "export async function faststallPeriod("), "arSuperadmin(user)", 'from("commission_period")'));
const ord = las("src/app/(app)/order/actions.ts");
const rad = kropp(ord, "export async function raderaOrder(");
ok("radera order: en order som lämnat utkastet kräver Superadmin före radera_order", fore(rad, "if (!arSuperadmin(user))", 'rpc("radera_order"'));
const pers = las("src/app/(app)/personal/actions.ts");
ok("radera anställd: taBortAnstalld prövar Superadmin före ta_bort_anstalld", fore(kropp(pers, "export async function taBortAnstalld("), "arSuperadmin(user)", 'rpc("ta_bort_anstalld"'));
const ae2 = las("src/app/nav2/anstallda/route.ts");
ok("radera anställd: /nav2/anstallda prövar Superadmin", ae2.includes('if ((await niva(mig)) !== "superadmin") return svar({ fel: "Bara en superadmin ändrar i personalen." }, 403);'));

// Händelselogg och Adoption.
const logg = las("src/app/(app)/logg/page.tsx");
ok("/logg: notFound för andra än Superadmin före läsningen", fore(logg, "if (!arSuperadmin(await getCurrentUser())) notFound();", 'from("audit_log")'));
for (const f of ["src/lib/nav2/logg.ts", "src/lib/nav2/adoption.ts"]) {
  ok(`Nav 2.0: ${path.basename(f)} ger null för andra än Superadmin`, las(f).includes('if (nivaFor(user.roles) !== "superadmin") return null;'));
}
const mig = las("supabase/migrations/0241_adoption_bara_superadmin.sql");
ok("0241: alla tre adoption_* kräver ceo eller admin", (mig.match(/has_any_role\(array\['ceo','admin'\]\)/g) ?? []).length === 3 && !mig.includes("'sales_manager'"));

// V4: rutinens bilaga.
const rt = las("src/app/(app)/rutiner/actions.ts");
const tb = kropp(rt, "export async function taBortBilaga(");
ok("V4: taBortBilaga prövar att filen är en bilaga på rutinen före taBortInnehall", fore(tb, '.eq("document_id", dokumentId)', "await taBortInnehall(") && fore(tb, '.eq("purpose", "document_attachment")', "await taBortInnehall("));

// Klienten: inget "förslag" kvar i kortet.
const ut = las("src/nav2/utkast.html");
const matris = ut.slice(ut.indexOf("const BRHMATRIS = ["), ut.indexOf("];", ut.indexOf("const BRHMATRIS = [")));
ok("BRHMATRIS: alla rader införda", matris.length > 0 && !/\], false\]/.test(matris));
ok("prf-hj: meningen om förslag är borta", !ut.includes("Rader märkta förslag är inte spärrade i utkastet än."));

console.log(fel ? `\n${fel} fel` : "\nalla gröna");
process.exit(fel ? 1 : 0);
