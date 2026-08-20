/**
 * Kraver losenordsbyte pa konton som redan finns.
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/krav-losenordsbyte.mjs [flaggor] [e-post ...]
 *
 * Flaggan `byt_losenord` sitter i auth-kontots `app_metadata` och satts av
 * navet sjalvt pa tva stallen: nar ett konto laggs upp, och nar en chef satter
 * ett nytt tillfalligt losenord. Konton som fanns *innan* tvanget byggdes gar
 * darfor fria. Det har skriptet ar vagen att na dem.
 *
 * Flaggor:
 *
 *   --kor        Gor andringen. Utan den visas bara vad som skulle ske.
 *   --alla       Alla konton som inte ar offboardade.
 *   --av         Ta bort tvanget i stallet for att satta det.
 *   --offboardade  Ta med offboardade konton (bara meningsfullt med --av).
 *
 * Utan `--kor` ar skriptet en torrkorning. Det ar avsiktligt: en korning med
 * fel urval skickar hela navet till `/byt-losenord` och den som inte kan sitt
 * gamla losenord kommer inte vidare darifran. Torrkorning som normallage
 * kostar en extra rad att skriva, och listan den skriver ut ar exakt den som
 * kommer att andras.
 *
 * Sjalva skrivningen gar mot GoTrues admin-API och inte mot `auth.users` med
 * SQL. Kolumnen `raw_app_meta_data` ar auth-schemats egen och det finns ingen
 * utfastelse om att den far skrivas utifran; admin-API:t ar den dokumenterade
 * vagen och det ar samma vag navet redan anvander.
 *
 * Inga beroenden. Bara `fetch` mot REST-granssnitten — skriptet kors dar det
 * rakar sta, aven i en katalog utan `node_modules`.
 */

const URL_BAS = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const NYCKEL =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";

if (!URL_BAS || !NYCKEL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY maste vara satta.");
  console.error("Kor med: node --env-file=$HOME/.clicknet/nav.env scripts/krav-losenordsbyte.mjs");
  process.exit(1);
}

/** Namnet star ocksa i src/lib/losenordsbyte.ts. Andras det maste bada andras. */
const FLAGGA = "byt_losenord";

const args = process.argv.slice(2);
const kor = args.includes("--kor");
const alla = args.includes("--alla");
const stangAv = args.includes("--av");
const medOffboardade = args.includes("--offboardade");
const adresser = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

if (!alla && adresser.length === 0) {
  console.error("Ange e-postadresser, eller --alla for samtliga konton.");
  console.error("Exempel: scripts/krav-losenordsbyte.mjs --kor anna@clicknet.se");
  process.exit(1);
}
if (alla && adresser.length > 0) {
  console.error("--alla och enskilda adresser gar inte ihop. Valj det ena.");
  process.exit(1);
}

const onskat = !stangAv;

const huvuden = {
  apikey: NYCKEL,
  Authorization: `Bearer ${NYCKEL}`,
  "Content-Type": "application/json",
};

async function rest(sokvag, init = {}) {
  const svar = await fetch(`${URL_BAS}${sokvag}`, {
    ...init,
    headers: { ...huvuden, ...(init.headers ?? {}) },
  });
  const text = await svar.text();
  if (!svar.ok) {
    throw new Error(`${init.method ?? "GET"} ${sokvag} -> ${svar.status} ${text}`);
  }
  // `Prefer: return=minimal` ger 201 med tom kropp, inte 204. Att lita pa
  // statuskoden och anda anropa .json() gav ett "Unexpected end of JSON input"
  // som sag ut som ett avvisat anrop fast skrivningen hade gatt igenom.
  return text ? JSON.parse(text) : null;
}

// Personalregistret ar urvalet, inte auth-listan. Ett auth-konto utan
// employee-rad ar antingen halvfardigt eller nagot som inte hor hemma i
// navet, och det ska inte tvingas till ett byte av ett skript pa kvallen.
const anstallda = await rest(
  "/rest/v1/employee?select=id,email,first_name,last_name,status,auth_user_id&order=email",
);

const urval = [];
const saknas = [];

if (alla) {
  for (const a of anstallda) {
    if (a.status === "offboarded" && !medOffboardade) continue;
    urval.push(a);
  }
} else {
  const perEpost = new Map(anstallda.map((a) => [String(a.email).toLowerCase(), a]));
  for (const e of adresser) {
    const traff = perEpost.get(e);
    if (traff) urval.push(traff);
    else saknas.push(e);
  }
}

// Allt eller inget vid stavfel. Halva urvalet flaggat och halva inte ar ett
// lage som ar svarare att reda ut an att bara kora om.
if (saknas.length > 0) {
  console.error(`Finns inte i personalregistret: ${saknas.join(", ")}`);
  console.error("Ingenting andrades. Ratta adresserna och kor igen.");
  process.exit(1);
}

console.log(
  `${kor ? "Kor" : "Torrkorning"}: ${stangAv ? "tar bort" : "satter"} kravet pa losenordsbyte ` +
    `for ${urval.length} konto${urval.length === 1 ? "" : "n"}.\n`,
);

let andrade = 0;
let redan = 0;
let fel = 0;

for (const a of urval) {
  const namn = `${a.first_name} ${a.last_name} <${a.email}>`;

  if (!a.auth_user_id) {
    console.log(`  - ${namn}: inget auth-konto, hoppas over`);
    fel++;
    continue;
  }

  try {
    /**
     * Las-andra-skriv, av samma skal som `kravByte` i personal/actions.ts:
     * `app_metadata` bar ocksa `provider` och `providers`, som auth sjalv
     * ager. GoTrue slar ihop nycklarna idag, men ett konto utan `provider`
     * gar inte att logga in pa och det ar inte vart att spara en fraga pa.
     */
    // GoTrue svarar med kontot direkt; supabase-js ar det som lagger pa
    // `{ user }` runt det. Bada formerna tas emot sa att skriptet inte gar
    // sonder av att endera sidan andrar sig.
    const svar = await rest(`/auth/v1/admin/users/${a.auth_user_id}`);
    const konto = svar?.user ?? svar;
    const nuvarande = konto?.app_metadata ?? {};

    if (!konto?.id) {
      console.error(`  ! ${namn}: auth-kontot gick inte att lasa`);
      fel++;
      continue;
    }

    if ((nuvarande[FLAGGA] === true) === onskat) {
      console.log(`  = ${namn}: redan ${onskat ? "flaggat" : "utan krav"}`);
      redan++;
      continue;
    }

    if (!kor) {
      console.log(`  > ${namn}`);
      andrade++;
      continue;
    }

    await rest(`/auth/v1/admin/users/${a.auth_user_id}`, {
      method: "PUT",
      body: JSON.stringify({ app_metadata: { ...nuvarande, [FLAGGA]: onskat } }),
    });

    // Kvittot. `actor_id` ar null — det ar ett skript och inte en person i
    // registret, precis som nattjobbet. Vem som kort det star i skalet.
    await rest("/rest/v1/audit_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        actor_id: null,
        action: onskat ? "auth.password_change_required" : "auth.password_change_cleared",
        object_type: "auth",
        object_id: a.auth_user_id,
        reason: "scripts/krav-losenordsbyte.mjs",
        meta: { epost: a.email, employee_id: a.id },
      }),
    });

    console.log(`  > ${namn}`);
    andrade++;
  } catch (e) {
    console.error(`  ! ${namn}: ${e instanceof Error ? e.message : String(e)}`);
    fel++;
  }
}

console.log(
  `\n${andrade} ${kor ? "andrade" : "skulle andras"}, ${redan} ororda, ${fel} misslyckades.`,
);

if (!kor && andrade > 0) {
  console.log("Lagg till --kor for att genomfora det.");
}
if (kor && andrade > 0 && onskat) {
  console.log(
    "De flaggade skickas till /byt-losenord vid nasta sidladdning och kommer\n" +
      "inte vidare forran de bytt. De maste kunna sitt nuvarande losenord —\n" +
      "sidan kraver det. Den som inte kan det behover ett nytt tillfalligt\n" +
      "losenord fran personalkortet i stallet.",
  );
}

process.exit(fel > 0 ? 1 : 0);
