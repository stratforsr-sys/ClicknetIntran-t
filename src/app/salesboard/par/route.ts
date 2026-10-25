import { skrivHandelse } from "@/lib/handelselogg-server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { KOD_GILTIG_MS, hasha, nyKod, nyToken, visaKod } from "@/lib/salesboard/parning";
import { lasParkakan, sattParkakan, sattSkarmkakan, taBortParkakan } from "@/lib/salesboard/atkomst";
import {
  arKodkrock,
  forMangaKoder,
  klientIp,
  parningsbeslut,
  webblasare,
  type Parningsrad,
} from "@/lib/salesboard/atkomstregler";
import { saknasAn } from "@/lib/salesboard/saknas";
import { svar } from "@/lib/salesboard/svar";

export const dynamic = "force-dynamic";

/**
 * Säljtavlan: parningen av en TV, som RFC 8628 (spec §9).
 *
 *   POST  TV:n får en kod på åtta tecken att visa ("K7M4-QX9P") och kakan
 *         `nav_tavla_par` med en nonce. Koden gäller i tio minuter.
 *   GET   TV:n frågar var tredje sekund. När en admin skrivit in koden i
 *         inställningarna pekar parningsraden på en skärm: då skapas tokenen,
 *         hashen sparas på skärmen, kakan `nav_tavla` sätts och raden tas bort.
 *         Annars `{klar: false}`, eller 410 när koden gått ut.
 *
 * Rutten är öppen, för TV:n har ingen session. Det som skyddar är att koden
 * inte går att lösa in utan TV:ns nonce, och att koden bara gäller i tio
 * minuter. Högst 50 koder får vara aktiva samtidigt och högst fem per adress
 * (ett /64 för IPv6), så att ingen kan fylla tabellen. En TV som laddar om får
 * sin gamla kod borttagen, så att omladdningar inte äter av kvoten.
 *
 * Databasen ser aldrig koden, noncen eller tokenen, bara deras sha256. Koden
 * hashas i den form `nyKod` ger: versaler utan streck, samma form som
 * `normaliseraKod` ger det admin skriver in, så att de två hasharna möts.
 *
 * Besluten (kvoten, adressens hink, TV:ns fråga) står som rena funktioner i
 * `atkomstregler.ts` och är provade. Före 0250 finns ingen parningstabell, och
 * då svarar rutten 503.
 */

const PARNING = "salesboard_pairing";
const SKARM = "salesboard_screen";

/**
 * En godkänd rad får så här lång tid på sig efter att koden gått ut innan den
 * städas bort. Admin kan godkänna i sista sekunden, och TV:n frågar var tredje.
 */
const INLOSEN_MS = 60_000;

const AV = "Säljtavlan är inte påslagen än.";

/** Ett fel från databasen, med tabellen det gällde: 503 före 0250, annars 500. */
function fel(e: { code?: string; message?: string }, tabell: string, vad: string) {
  if (saknasAn(tabell, e)) return svar({ fel: AV }, 503);
  console.error(`salesboard/par: ${vad} (${tabell}):`, e.code ?? "", e.message ?? e);
  return svar({ fel: "Något gick fel. Försök igen om en stund." }, 500);
}

/** Koden har gått ut eller finns inte: TV:n visar en ny. Kakan tas bort. */
function utgangen(text = "Koden har gått ut.") {
  const res = svar({ fel: text }, 410);
  taBortParkakan(res);
  return res;
}

export async function POST(request: Request) {
  const db = supabaseAdmin();
  const nu = Date.now();
  const ip = klientIp(request.headers);

  const { error: stadfel } = await db.from(PARNING).delete().lt("expires_at", new Date(nu - INLOSEN_MS).toISOString());
  if (stadfel) return fel(stadfel, PARNING, "städningen");

  // Samma TV som laddar om har kvar sin parningskaka. Dess gamla kod tas bort
  // och räknas inte. En kod som admin redan godkänt ligger kvar för inlösen.
  const gammal = await lasParkakan();
  if (gammal) {
    const { error: bortfel } = await db.from(PARNING).delete().eq("nonce_hash", hasha(gammal)).is("screen_id", null);
    if (bortfel) return fel(bortfel, PARNING, "den gamla koden");
  }

  // Adresserna på de koder som gäller. Högst 50 rader, eftersom fler aldrig släpps in.
  const { data: aktiva, error: raknefel } = await db
    .from(PARNING)
    .select("ip")
    .gt("expires_at", new Date(nu).toISOString());
  if (raknefel) return fel(raknefel, PARNING, "räkningen");
  const adresser = ((aktiva ?? []) as { ip: string | null }[]).map((r) => r.ip);
  if (forMangaKoder(adresser, ip)) {
    return svar({ fel: "För många koder just nu. Försök igen om några minuter." }, 429);
  }

  const giltigTill = new Date(nu + KOD_GILTIG_MS).toISOString();
  // Två försök: en kod som redan finns (40 bitar, några tiotal aktiva) är så
  // osannolik att ett andra försök räcker, och ett tredje hade dolt ett fel.
  for (let forsok = 0; forsok < 2; forsok++) {
    const kod = nyKod();
    const nonce = nyToken();
    const { error } = await db.from(PARNING).insert({
      code_hash: hasha(kod),
      nonce_hash: hasha(nonce),
      expires_at: giltigTill,
      ip,
      user_agent: webblasare(request.headers),
    });
    if (!error) {
      const res = svar({ kod: visaKod(kod), giltigTill });
      sattParkakan(res, nonce);
      return res;
    }
    if (!arKodkrock(error)) return fel(error, PARNING, "koden");
  }
  return svar({ fel: "Det gick inte att skapa en kod. Försök igen." }, 500);
}

export async function GET(request: Request) {
  const nonce = await lasParkakan();
  if (!nonce) return utgangen();

  const db = supabaseAdmin();
  const nonceHash = hasha(nonce);
  const { data, error } = await db.from(PARNING).select("expires_at, screen_id").eq("nonce_hash", nonceHash).maybeSingle();
  if (error) return fel(error, PARNING, "uppslaget");

  const beslut = parningsbeslut(data as Parningsrad | null, Date.now());
  if (beslut.typ === "utgangen") return utgangen();
  if (beslut.typ === "vanta") return svar({ klar: false });

  // Godkänd. Raden löses in en gång: den fråga som raderar den får skärmen.
  const { data: losta, error: losfel } = await db.from(PARNING).delete().eq("nonce_hash", nonceHash).select("screen_id");
  if (losfel) return fel(losfel, PARNING, "inlösen");
  const skarmId = ((losta ?? []) as { screen_id: string | null }[])[0]?.screen_id ?? null;
  if (!skarmId) return svar({ klar: false });

  const token = nyToken();
  const { data: skarm, error: skarmfel } = await db
    .from(SKARM)
    .update({ token_hash: hasha(token), claimed_at: new Date().toISOString() })
    .eq("id", skarmId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (skarmfel) return fel(skarmfel, SKARM, "skärmen");
  // Skärmen kopplades bort mellan godkännandet och inlösen.
  if (!skarm) return utgangen("Skärmen har kopplats bort.");

  await skrivHandelse({
    actorId: null,
    action: "salesboard.screen_claimed",
    objectType: "salesboard_screen",
    objectId: skarmId,
    meta: { ip: klientIp(request.headers) },
  });

  const res = svar({ klar: true });
  sattSkarmkakan(res, token);
  taBortParkakan(res);
  return res;
}
