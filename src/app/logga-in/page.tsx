import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import {
  KONTOKAKA,
  avatarFarg,
  dagText,
  fornamn,
  halsning,
  iStockholm,
  initialer,
  lasKonto,
  malNamn,
  sakerNasta,
  senastText,
} from "@/lib/inloggning";
import type { KontoVy } from "./falt";
import { Skal } from "./Skal";
import { Inloggning, type Ingang } from "./Inloggning";

export const metadata: Metadata = { title: "Logga in — Clicknet Nav" };

/** Adressfältet i mobilens webbläsare i samma ton som sidan. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1EC" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1210" },
  ],
};

/**
 * Sidan läser allt den behöver innan den ritas, så att formuläret är rätt
 * från första bilden och inte hoppar när skriptet kommit:
 *
 *   - `nasta`: dit mellanvaran ville skicka en, med frågan kvar
 *     (/kalender?dag=… ur ett mejl). Bara vägar inom navet, se sakerNasta.
 *   - `fel=lank` från /auth/bekrafta och `utloggad` från /auth/logga-ut.
 *   - kontot som loggade in senast på den här enheten, och hälsningen och
 *     datumraden i svensk tid. Texterna räknas ut här och inte i webbläsaren,
 *     så att servern och skärmen säger samma sak.
 */
export default async function LoggaIn({
  searchParams,
}: {
  searchParams: Promise<{ nasta?: string; fel?: string; utloggad?: string }>;
}) {
  const sp = await searchParams;
  const nu = new Date();
  const sparat = lasKonto((await cookies()).get(KONTOKAKA)?.value);
  const konto: KontoVy | null = sparat
    ? {
        epost: sparat.epost,
        namn: sparat.namn,
        fornamn: fornamn(sparat.namn),
        // Utan namn: "zen.andersson@…" ger ZA, som namnet hade gett.
        initialer: initialer(sparat.namn ?? sparat.epost.split("@")[0].replace(/[._-]+/g, " ")),
        farg: avatarFarg(sparat.namn ?? sparat.epost),
        senast: sparat.senast ? senastText(new Date(sparat.senast), nu) : null,
      }
    : null;
  const nasta = sakerNasta(sp.nasta);
  const ingang: Ingang = sp.fel === "lank" ? "lank" : sp.utloggad !== undefined ? "utloggad" : null;

  return (
    <Skal fot="Saknar du konto? Be din chef lägga upp dig i navet.">
      <Inloggning
        konto={konto}
        nasta={nasta}
        mal={malNamn(nasta)}
        halsning={halsning(iStockholm(nu).minut)}
        dag={dagText(nu)}
        ingang={ingang}
      />
    </Skal>
  );
}
