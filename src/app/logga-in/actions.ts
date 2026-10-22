"use server";

import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { loggaInloggning, loggaMisslyckadInloggning } from "@/lib/inloggningslogg-server";
import { namnFor } from "@/lib/inloggning-server";
import { skickaKodmejl } from "@/lib/kodmejl-server";
import { ATERSTALL_KAKA, skapaAterstallning } from "@/lib/aterstallning";
import { BYTESVAG, kraverByte } from "@/lib/losenordsbyte";
import {
  DOMAN,
  KONTOKAKA,
  TEXT,
  fornamn,
  liknarEpost,
  normaliseraEpost,
  oppnarText,
  sakerNasta,
  skrivKonto,
  tolkaAuthFel,
  type Felorsak,
} from "@/lib/inloggning";

/**
 * Svaret till formuläret. Ingen av handlingarna skickar vidare själv
 * (`redirect`): sidan säger "Välkommen" medan nästa sida laddas, och den
 * vet vart den ska av `klar`.
 *
 *   fel, falt  vad som gick fel och vilket fält det gäller (fokus och markering)
 *   felkod     "fel" räknas mot förslaget om kod, "sparr" spärrar knappen,
 *              "natfel" och "tjanst" säger att det inte är den som skriver
 *   epost      adressen tillbaka: React tömmer formuläret efter varje svar
 *   vanta      sekunder tills nästa försök får göras
 *   skickat    adressen en kod gick till, så visar sidan kodfältet
 */
export type LoginState = {
  fel?: string;
  falt?: "epost" | "losenord" | "kod";
  felkod?: "fel" | "sparr" | "natfel" | "tjanst";
  epost?: string;
  vanta?: number;
  skickat?: string;
  klar?: { till: string; namn: string | null; text: string };
};

const SAKER_KAKA = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

/**
 * Kontot sparas på enheten efter en lyckad inloggning: adressen, namnet och
 * tiden. Nästa gång hälsar sidan med namn, och bara lösenordet behövs.
 *
 * Bara på inloggningens egna adresser (`path`), så att kakan inte följer med
 * i varje annan begäran, och httpOnly, så att inget skript på sidan kan läsa
 * den. "Byt konto" tar bort den (`glomKontot`). Den gäller ett halvår från
 * senaste inloggningen: en enhet som ingen loggat in på sedan dess glömmer
 * kontot av sig själv.
 */
async function kommIhag(epost: string, namn: string | null) {
  (await cookies()).set(KONTOKAKA, skrivKonto({ epost, namn, senast: new Date().toISOString() }), {
    ...SAKER_KAKA,
    path: "/logga-in",
    maxAge: 60 * 60 * 24 * 183,
  });
}

function kontrolleraAdress(epost: string): LoginState | null {
  if (!epost) return { fel: "Skriv din e-postadress.", falt: "epost" };
  if (!liknarEpost(epost)) {
    return { fel: `Skriv hela adressen, till exempel fornamn@${DOMAN}.`, falt: "epost", epost };
  }
  return null;
}

/**
 * Ett nekat lösenord, med navets ord. `sparat`: adressen är enhetens sparade
 * konto, och då är det lösenordet som är fel. Det säger ingenting om vilka
 * andra adresser som finns.
 */
function losenordsfel(orsak: Felorsak, sparat: boolean): LoginState {
  switch (orsak.typ) {
    case "fel":
    case "okant":
      return { fel: sparat ? "Lösenordet stämmer inte." : "Fel e-post eller lösenord.", falt: "losenord", felkod: "fel" };
    case "sparr":
      return { fel: "För många försök i rad. Vänta en stund, eller logga in med en kod.", felkod: "sparr", vanta: orsak.sekunder };
    case "obekraftad":
      return { fel: "Adressen är inte bekräftad än. Logga in med en kod till mejlen i stället.", falt: "epost" };
    case "avstangd":
      return { fel: "Kontot är avstängt. Prata med din chef om du ska ha tillgång." };
    case "adress":
      return { fel: `Skriv hela adressen, till exempel fornamn@${DOMAN}.`, falt: "epost" };
    default:
      return { fel: TEXT.tjanst, felkod: "tjanst" };
  }
}

/** Ett nekat kodförsök. GoTrue skiljer inte på fel kod och utgången kod. */
function kodfel(orsak: Felorsak): LoginState {
  if (orsak.typ === "sparr") return { fel: TEXT.kodSparr, felkod: "sparr", vanta: orsak.sekunder, falt: "kod" };
  if (orsak.typ === "tjanst") return { fel: TEXT.tjanst, felkod: "tjanst", falt: "kod" };
  return { fel: TEXT.kodFel, felkod: "fel", falt: "kod" };
}

/** AC-1.1: inloggning med lösenord. */
export async function loggaInMedLosenord(_prev: LoginState, form: FormData): Promise<LoginState> {
  const epost = normaliseraEpost(form.get("epost"));
  const losenord = String(form.get("losenord") ?? "");
  const fel = kontrolleraAdress(epost);
  if (fel) return fel;
  if (!losenord) return { fel: "Skriv ditt lösenord.", falt: "losenord", epost };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email: epost, password: losenord });

  if (error || !data.user) {
    const svar = losenordsfel(error ? tolkaAuthFel(error) : { typ: "tjanst" }, form.get("sparat") === "1");
    await loggaMisslyckadInloggning(epost, "losenord", svar.fel ?? "");
    return { ...svar, epost };
  }

  // Loggen före kakan: blir något fel i kakan ska inloggningen ändå stå i loggen.
  await loggaInloggning(epost, "losenord");
  const namn = await namnFor(data.user.id);
  await kommIhag(epost, namn);

  if (kraverByte(data.user.app_metadata)) {
    return { klar: { till: BYTESVAG, namn: fornamn(namn), text: "Först väljer du ett eget lösenord…" } };
  }
  const till = sakerNasta(form.get("nasta"));
  return { klar: { till, namn: fornamn(namn), text: oppnarText(till) } };
}

/**
 * En engångskod till mejlen: för den som hellre loggar in så, och för den som
 * glömt lösenordet. Mejlet är navets eget (src/lib/kodmejl-server.ts), och
 * koden skickas bara till adresser i personalregistret.
 *
 * SAMMA SVAR OM ADRESSEN SAKNAR KONTO, och samma svar när en kod redan gått
 * till adressen inom en minut (spärren per person). Spärren gäller bara
 * adresser som har konto, så ett eget svar för den hade röjt dem. Den förra
 * koden gäller ju fortfarande, och nedräkningen i sidan håller nästa begäran
 * efter spärren.
 */
export async function skickaKod(_prev: LoginState, form: FormData): Promise<LoginState> {
  const epost = normaliseraEpost(form.get("epost"));
  const fel = kontrolleraAdress(epost);
  if (fel) return fel;

  const start = Date.now();
  const utfall = await skickaKodmejl(epost, form.get("syfte") === "glomt" ? "glomt" : "logga-in");
  await jamnaUt(start);
  if (utfall === "okand") {
    await loggaMisslyckadInloggning(epost, "kod", "Adressen saknar konto.");
    return { skickat: epost, epost };
  }
  if (utfall === "skickad" || utfall === "sparr") return { skickat: epost, epost };
  return {
    fel: `${utfall === "mejlgrans" ? TEXT.mejlgrans : TEXT.ejSkickad} Logga in med lösenord så länge.`,
    felkod: "tjanst",
    epost,
  };
}

/**
 * Koden från mejlet.
 *
 * Med syftet "glomt", eller när kontot har ett tvingat byte, skrivs ett kvitto
 * som låter /byt-losenord sätta ett nytt lösenord utan det gamla (se
 * aterstallning.ts): den som visat att den äger brevlådan ska inte behöva
 * ett tillfälligt lösenord den kanske aldrig fått.
 */
export async function loggaInMedKod(_prev: LoginState, form: FormData): Promise<LoginState> {
  const epost = normaliseraEpost(form.get("epost"));
  const kod = String(form.get("kod") ?? "").replace(/\D/g, "");
  const glomt = form.get("syfte") === "glomt";
  if (!liknarEpost(epost)) return { fel: "Adressen saknas. Välj Ändra adressen och skriv den igen.", falt: "kod" };
  if (!kod) return { fel: "Skriv in koden från mejlet.", falt: "kod", epost };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email: epost, token: kod, type: "email" });

  if (error || !data.user) {
    const svar = kodfel(error ? tolkaAuthFel(error) : { typ: "kod" });
    await loggaMisslyckadInloggning(epost, "kod", svar.fel ?? "");
    return { ...svar, epost };
  }

  await loggaInloggning(epost, "kod");
  const namn = await namnFor(data.user.id);
  await kommIhag(epost, namn);

  const tvang = kraverByte(data.user.app_metadata);
  if (glomt || tvang) {
    const { varde, utgang } = await skapaAterstallning(data.user.id);
    (await cookies()).set(ATERSTALL_KAKA, varde, { ...SAKER_KAKA, path: BYTESVAG, expires: utgang });
    return {
      klar: {
        till: BYTESVAG,
        namn: fornamn(namn),
        text: glomt ? "Nu väljer du ett nytt lösenord…" : "Först väljer du ett eget lösenord…",
      },
    };
  }

  const till = sakerNasta(form.get("nasta"));
  return { klar: { till, namn: fornamn(namn), text: oppnarText(till) } };
}

/**
 * Lika lång tid oavsett utfall. En okänd adress svarar annars på ett ögonblick
 * och en känd först när mejlet är skickat, och då röjer klockan det som svaret
 * döljer. Ett utskick tar sällan över en sekund.
 */
const MINST_MS = 1200;

async function jamnaUt(start: number) {
  const kvar = MINST_MS - (Date.now() - start);
  if (kvar > 0) await new Promise((klar) => setTimeout(klar, kvar));
}

/** "Byt konto": enheten glömmer kontot, och sidan visar adressfältet igen. */
export async function glomKontot(): Promise<void> {
  (await cookies()).delete({ name: KONTOKAKA, path: "/logga-in" });
}
