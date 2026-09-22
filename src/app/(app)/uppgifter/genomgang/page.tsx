import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { veckonummer } from "@/lib/kalender";
import {
  genomgangslage,
  nastaVeckansDagar,
  nastaVeckansNummer,
  senasttext,
  stegantal,
  type Genomgangsprojekt,
  type Genomgangsrad,
} from "@/lib/genomgang";
import { senasteGenomgang, senasteKvitton } from "@/lib/genomgang-server";
import { hamtaUppgiftsbild, stilla } from "@/lib/uppgifter-server";
import { Genomgang } from "./Genomgang";

export const dynamic = "force-dynamic";

export const metadata = { title: "Veckogenomgång" };

/**
 * Veckogenomgången.
 *
 * ===========================================================================
 * SIDAN HÄMTAR INGENTING EGET UTOM ETT DATUM
 *
 * Allt som ritas kommer ur `hamtaUppgiftsbild()` — samma fem frågor som
 * `/uppgifter` och kalendern redan ställer — och stegen är rena filter över den
 * bilden. Den enda egna läsningen är `senasteGenomgang()`, som svarar på om
 * veckan redan är avbetad.
 *
 * Det är inte en optimering utan hela konstruktionen: ett steg som hämtade sina
 * egna rader hade varit ett andra svar på "vad ligger på mig", och det andra
 * svaret glider. Den dag det gör det säger genomgången att tre saker är
 * försenade medan uppgiftssidan säger fyra, och då är det ingen av dem man tror
 * på.
 *
 * SIDAN LIGGER UNDER `/uppgifter` OCH INTE I SIDOPANELEN. Femtaket i
 * nav-items.ts står kvar: `/uppgifter` fick sitt undantag 2026-09-11 med
 * argumentet att en lista över det man inte får glömma, placerad bakom ett
 * klick, är en lista man slutar öppna. Genomgången är tvärtom något man gör en
 * gång i veckan, och vägen dit går via kortet på uppgiftssidan och via klockan
 * på fredagen — alltså vid det tillfälle den är aktuell, vilket är bättre än en
 * permanent post man går förbi fyra dagar av fem.
 * ===========================================================================
 */
export default async function Genomgangssidan() {
  const user = await getCurrentUser();
  if (!user?.employee) {
    return (
      <EmptyState
        rubrik="Veckogenomgång"
        text="Ditt konto är inte kopplat till en anställd än, så det finns ingenting att gå igenom."
      />
    );
  }

  const mig = user.employee.id;
  const [bild, senaste, kvitton] = await Promise.all([
    hamtaUppgiftsbild(user),
    senasteGenomgang(user),
    senasteKvitton(user, 1),
  ]);

  const idag = bild.idag;

  /**
   * `stilla` räknas HÄR och inte i lib/genomgang.ts.
   *
   * Talet kommer ur `updated_at`, som är en tidpunkt — att göra om den till en
   * svensk kalenderdag kräver en tidszon, och den kunskapen bor i `klocka.ts`
   * på serversidan. `stilla()` i uppgifter-server.ts gör det redan för
   * delegeringslistan, och ett andra räknesätt hade gett två olika svar på hur
   * länge samma uppgift stått still.
   */
  const rader: Genomgangsrad[] = bild.uppgifter.map((u) => ({ ...u, stilla: stilla(u, idag) }));

  const projekt: Genomgangsprojekt[] = bild.projekt.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    due_date: p.due_date,
    archived_at: p.archived_at,
  }));

  const lage = genomgangslage(idag, senaste);
  const antal = stegantal(rader, projekt, mig, idag);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-display text-ink-900">Veckogenomgång</h1>
          <p className="text-body text-ink-500">
            Vecka {veckonummer(idag)} · {senasttext(lage)}
            {kvitton[0] && lage.gjord
              ? kvitton[0].remaining === 0
                ? " · allt avbetat"
                : ` · ${kvitton[0].remaining} kvar`
              : ""}
          </p>
        </div>
        <Link
          href="/uppgifter"
          className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-small text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
        >
          Tillbaka till uppgifterna
        </Link>
      </header>

      <Genomgang
        rader={rader}
        projekt={projekt}
        namn={Object.fromEntries(bild.namn)}
        mig={mig}
        idag={idag}
        antal={antal}
        redanGjord={lage.gjord}
        nastaVeckansDagar={nastaVeckansDagar(idag)}
        nastaVeckansNummer={nastaVeckansNummer(idag)}
      />
    </div>
  );
}
