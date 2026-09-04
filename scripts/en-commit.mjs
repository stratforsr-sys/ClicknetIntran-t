#!/usr/bin/env node
/**
 * ETT PASS = EN COMMIT = EN DEPLOY.
 *
 * ===========================================================================
 * VARFOR SKRIPTET FINNS
 *
 * Arbetet i det har repot sker via GitHub API utan lokal klon. Den enkla vagen
 * ar Contents API — `gh api -X PUT .../contents/<fil>` — men den skriver EN FIL
 * per anrop, och varje anrop blir en egen commit. Varje commit pa en bevakad
 * branch blir i sin tur en Vercel-deploy.
 *
 * Vercel-projektet ligger pa fria planen: 100 deployer per dygn. Den 2026-09-04
 * skrevs ett pass pa trettiofem filer fil for fil, kvoten tog slut mitt i, och
 * bade git-integrationen och `vercel redeploy` borjade svara
 * `402 api-deployments-free-per-day`. Det ar en PLANGRANS och inte ett fel —
 * den gar inte att trycka igenom med omforsok, den slapper efter ett dygn.
 *
 * DET DYRA VAR INTE DEPLOYERNA UTAN VERIFIERINGEN. Bygget som hann ga igenom
 * tackte bara halva andringen; de nio sista commitarna blev aldrig byggda, och
 * ingenting kunde sagas om dem forran dygnet efter.
 *
 * Skriptet gor hela passet till en commit: en blob per fil, ETT trad ovanpa
 * grenens nuvarande, en commit, en ref-uppdatering. Historiken sager da vad som
 * byggdes i stallet for i vilken ordning filerna rakade skrivas.
 * ===========================================================================
 *
 *   node scripts/en-commit.mjs <branch> "<meddelande>" <lokal>:<i-repot> ...
 *
 * Exempel:
 *   node scripts/en-commit.mjs min-gren "Notiser: klockan sager till om allt" \
 *     src/lib/notiser.ts:src/lib/notiser.ts \
 *     /tmp/ny-klocka.tsx:src/components/shell/Notisklocka.tsx
 *
 * Star sokvagen likadant pa bada hallen racker den en gang:
 *   node scripts/en-commit.mjs min-gren "..." src/lib/notiser.ts
 *
 * `--radera <sokvag>` tar bort en fil i samma commit.
 * `--torrkor` visar vad som skulle hant utan att skriva.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = "stratforsr-sys/ClicknetIntran-t";

/** `gh api` med en JSON-kropp. Kastar med GitHubs eget felmeddelande. */
function gh(metod, vag, kropp) {
  const args = ["api", "-X", metod, `repos/${REPO}/${vag}`];
  if (kropp !== undefined) args.push("--input", "-");
  try {
    return JSON.parse(
      execFileSync("gh", args, {
        input: kropp === undefined ? undefined : JSON.stringify(kropp),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch (e) {
    const svar = e.stdout || e.stderr || e.message;
    throw new Error(`${metod} ${vag} misslyckades: ${String(svar).trim()}`);
  }
}

const argv = process.argv.slice(2);
const torrkor = argv.includes("--torrkor");
const rest = argv.filter((a) => a !== "--torrkor");

const branch = rest.shift();
const meddelande = rest.shift();

if (!branch || !meddelande || rest.length === 0) {
  console.error(
    "Anvandning: node scripts/en-commit.mjs <branch> \"<meddelande>\" <lokal>[:<i-repot>] ...\n" +
      "            --radera <sokvag>   tar bort en fil i samma commit\n" +
      "            --torrkor           visar utan att skriva",
  );
  process.exit(1);
}

/** Filerna som ska in, och de som ska bort. */
const filer = [];
const raderas = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--radera") {
    const vag = rest[++i];
    if (!vag) throw new Error("--radera behover en sokvag.");
    raderas.push(vag);
    continue;
  }
  // Kolon delar lokal fran repo. En Windows-enhetsbokstav finns inte har, men
  // en absolut sokvag kan innehalla kolon i teorin — darfor SISTA kolonet.
  const bit = rest[i];
  const delare = bit.lastIndexOf(":");
  const lokal = delare > 0 ? bit.slice(0, delare) : bit;
  const iRepot = delare > 0 ? bit.slice(delare + 1) : bit;
  filer.push({ lokal, iRepot });
}

// Grenens spets. Trädet byggs OVANPA den, sa allt som inte namns star kvar.
const ref = gh("GET", `git/ref/heads/${branch}`);
const forra = ref.object.sha;
const bas = gh("GET", `git/commits/${forra}`).tree.sha;

console.log(`Gren ${branch} star pa ${forra.slice(0, 7)} (trad ${bas.slice(0, 7)})`);

const poster = [];
for (const { lokal, iRepot } of filer) {
  const innehall = readFileSync(lokal);
  if (torrkor) {
    console.log(`  + ${iRepot}  (${innehall.length} B)`);
    continue;
  }
  const blob = gh("POST", "git/blobs", {
    content: innehall.toString("base64"),
    encoding: "base64",
  });
  console.log(`  + ${iRepot}  ${blob.sha.slice(0, 7)}`);
  poster.push({ path: iRepot, mode: "100644", type: "blob", sha: blob.sha });
}

for (const vag of raderas) {
  console.log(`  - ${vag}`);
  // `sha: null` i ett trad ovanpa `base_tree` betyder BORTTAGEN.
  if (!torrkor) poster.push({ path: vag, mode: "100644", type: "blob", sha: null });
}

if (torrkor) {
  console.log(`\nTorrkorning. Skulle blivit EN commit: "${meddelande}"`);
  process.exit(0);
}

const trad = gh("POST", "git/trees", { base_tree: bas, tree: poster });

/**
 * Ett trad identiskt med basen betyder att ingen fil faktiskt andrats.
 * GitHub dedupliderar pa innehall, sa en oforandrad fil ger samma blob-sha och
 * samma trad. Att skriva en tom commit anda hade kostat en deploy for ingenting
 * — vilket ar precis det skriptet finns for att undvika.
 */
if (trad.sha === bas) {
  console.log("\nIngen fil skiljer sig fran grenen. Ingen commit skriven.");
  process.exit(0);
}

const commit = gh("POST", "git/commits", {
  message: meddelande,
  tree: trad.sha,
  parents: [forra],
});

gh("PATCH", `git/refs/heads/${branch}`, { sha: commit.sha });

console.log(
  `\nEN commit: ${commit.sha.slice(0, 7)}  "${meddelande}"\n` +
    `${poster.length} fil(er), en deploy.`,
);
