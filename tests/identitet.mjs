#!/usr/bin/env node
/**
 * Identitetsrubriken — bade formen och det som faktiskt haller den tat.
 *
 * ===========================================================================
 * VARFOR DET HAR PROVET MASTE FINNAS
 *
 * `getCurrentUser()` litar sedan 2026-08-26 pa en request-rubrik i stallet for
 * att fraga Supabase Auth en andra gang. Det som gor rubriken palitlig ar EN
 * rad i mellanvaran: `rensaIdentitet(headers)`, som kastar bort rubriken om
 * nagon utifran skickat den.
 *
 * Faller den raden bort — vid en omskrivning, en sammanslagning, en ny gren som
 * returnerar tidigare — sa slutar ingenting fungera. Inloggningen gar som forr,
 * alla sidor laddar, alla andra prov ar grona. Det enda som hant ar att vem som
 * helst kan skicka `x-nav-auth-id: <nagon annans uuid>` och bli den personen.
 *
 * EN TYST TOTAL FORBIGANG AV HELA BEHORIGHETSMODELLEN. Det ar den sortens fel
 * som bara ett prov hittar, och darfor gar det har provet mot den RIKTIGA
 * adressen och skickar en riktig forfalskning.
 * ===========================================================================
 *
 *   node --experimental-strip-types tests/identitet.mjs
 *
 * Delen mot produktionen hoppas over om NAV_URL inte svarar.
 */
import {
  RUBRIK_ID,
  RUBRIK_EPOST,
  RUBRIK_BYTE,
  lasIdentitet,
  rensaIdentitet,
  skrivIdentitet,
} from "../src/lib/identitet.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const PROD = process.env.NAV_URL ?? "https://clicknet-nav.vercel.app";
const NAGON_ANNAN = "826a8b10-34c4-46ff-81d1-ca797773235c";

console.log("\n\x1b[1mRensningen tar bort det som kom utifran\x1b[0m");
{
  const h = new Headers({
    [RUBRIK_ID]: "en-angripare",
    [RUBRIK_EPOST]: "chef@clicknet.se",
    [RUBRIK_BYTE]: "1",
    "x-nonce": "ska-vara-kvar",
  });

  rensaIdentitet(h);

  ok("id:t ar borta", h.get(RUBRIK_ID) === null);
  ok("e-posten ar borta", h.get(RUBRIK_EPOST) === null);
  ok("bytesflaggan ar borta", h.get(RUBRIK_BYTE) === null);
  ok("och ingenting annat rors", h.get("x-nonce") === "ska-vara-kvar");
  ok("efter rensning finns ingen identitet att lasa", lasIdentitet(h) === null);
}

console.log("\n\x1b[1mSkrivningen och lasningen ar varandras motsatser\x1b[0m");
{
  const h = new Headers();
  skrivIdentitet(h, { id: "abc-123", email: "anna@clicknet.se" }, false);
  const i = lasIdentitet(h);

  ok("id:t kommer tillbaka", i?.authUserId === "abc-123");
  ok("e-posten kommer tillbaka", i?.email === "anna@clicknet.se");
  ok("bytesflaggan ar falsk nar den inte skrevs", i?.kraverLosenordsbyte === false);

  const h2 = new Headers();
  skrivIdentitet(h2, { id: "abc-123", email: "anna@clicknet.se" }, true);
  ok("och sann nar den skrevs", lasIdentitet(h2)?.kraverLosenordsbyte === true);

  // En rubrik far bara innehalla vissa tecken. Faller e-posten bort ska det
  // INTE ta id:t med sig — `getCurrentUser()` tar da e-posten ur employee-raden.
  const h3 = new Headers();
  skrivIdentitet(h3, { id: "abc-123", email: "räksmörgås@clicknet.se" }, false);
  ok("ett omojligt e-postvarde tappas utan att ta id:t med sig",
    lasIdentitet(h3)?.authUserId === "abc-123" && lasIdentitet(h3)?.email === null);

  const h4 = new Headers();
  skrivIdentitet(h4, { id: "abc-123", email: null }, false);
  ok("e-post null gar bra", lasIdentitet(h4)?.authUserId === "abc-123");
}

console.log("\n\x1b[1mUtan rubrik finns ingen identitet\x1b[0m");
{
  ok("tom rubriksamling ger null", lasIdentitet(new Headers()) === null);
  ok("bara e-post utan id ger null",
    lasIdentitet(new Headers({ [RUBRIK_EPOST]: "a@b.se" })) === null,
    "id:t ar det enda som far avgora");
}

// ---------------------------------------------------------------------------
// Mot den riktiga adressen. Det ar den har delen som betyder nagot.
// ---------------------------------------------------------------------------

console.log(`\n\x1b[1mForfalskad rubrik mot ${PROD}\x1b[0m`);
{
  let uppe = false;
  try {
    const r = await fetch(PROD + "/logga-in", { redirect: "manual" });
    uppe = r.status < 500;
  } catch {
    uppe = false;
  }

  if (!uppe) {
    console.log("  \x1b[33m–\x1b[0m hoppas over: adressen svarar inte");
  } else {
    // Ingen sessionskaka. Bara rubriken, som en angripare hade skickat den.
    const svar = await fetch(PROD + "/", {
      headers: {
        [RUBRIK_ID]: NAGON_ANNAN,
        [RUBRIK_EPOST]: "zen@clicknet.se",
        "user-agent": "clicknet-nav-identitetsprov",
      },
      redirect: "manual",
    });

    // Mellanvaran ska ha rensat rubriken, sett att det inte finns nagon
    // session, och skickat vidare till inloggningen.
    const dit = svar.headers.get("location") ?? "";
    ok("en forfalskad rubrik utan session slapper INTE in",
      svar.status >= 300 && svar.status < 400 && dit.includes("/logga-in"),
      `HTTP ${svar.status} -> ${dit || "(ingen omdirigering)"}`);

    if (svar.status === 200) {
      const kropp = await svar.text();
      ok("och sidan bar inte den utpekade personens uppgifter",
        !kropp.includes("Zen"),
        "HTTP 200 med rubriken satt betyder att rensaIdentitet() inte kordes");
    }

    // Samma sak mot en sida som kraver en chefsroll. Skulle rubriken slappas
    // igenom vore det har vagen till lonekostnaderna.
    const kanslig = await fetch(PROD + "/lonekostnad", {
      headers: { [RUBRIK_ID]: NAGON_ANNAN, "user-agent": "clicknet-nav-identitetsprov" },
      redirect: "manual",
    });
    const dit2 = kanslig.headers.get("location") ?? "";
    ok("inte heller till en sida som kraver behorighet",
      kanslig.status >= 300 && kanslig.status < 400 && dit2.includes("/logga-in"),
      `HTTP ${kanslig.status} -> ${dit2 || "(ingen omdirigering)"}`);
  }
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
