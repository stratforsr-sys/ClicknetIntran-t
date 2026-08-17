/**
 * Provsandning. Bekraftar att nyckeln, avsandaren och domanen hanger ihop
 * innan nagot nattjobb forlitar sig pa dem.
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/testa-epost.mjs zen@clicknet.se
 *
 * Skriver ut Resends id vid traff. Det id:t gar att slaa upp i deras logg om
 * mejlet aldrig dyker upp i inkorgen — da ligger felet efter avsandningen.
 */

const till = process.argv[2];
const nyckel = process.env.RESEND_API_KEY?.trim();
const fran = process.env.EMAIL_FROM?.trim();

if (!till) {
  console.error("Ange mottagare: node scripts/testa-epost.mjs adress@exempel.se");
  process.exit(1);
}

if (!nyckel || !fran) {
  console.error("RESEND_API_KEY eller EMAIL_FROM saknas i miljon.");
  process.exit(1);
}

const svar = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${nyckel}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: fran,
    to: [till],
    subject: "Provsandning fran Clicknet Nav",
    text: [
      "Det har brevet bekraftar att navet kan mejla.",
      "",
      `Avsandare: ${fran}`,
      `Skickat: ${new Date().toLocaleString("sv-SE")}`,
      "",
      "Hamnade det i skrappost? Da behover DMARC skarpas fran p=none.",
    ].join("\n"),
  }),
});

const text = await svar.text();

if (!svar.ok) {
  console.error(`FEL ${svar.status}: ${text}`);
  process.exit(1);
}

console.log(`OK — skickat till ${till}. ${text}`);
