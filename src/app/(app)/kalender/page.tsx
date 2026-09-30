import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { hamtaLeveranskalender } from "@/lib/leveranskalender-server";
import { arDatum, arVy, hemdag } from "@/lib/leveranskalender";
import { Leveranskalender } from "./LK/Leveranskalender";
import { Planeringssidan } from "./Planeringssidan";
import "./leveranskalender.css";

export const dynamic = "force-dynamic";

/**
 * Tiden en handling får ta. Varje ändring tömmer utkorgen i `after()` när
 * ångerfönstret på tio sekunder gått ut, och det räknas mot funktionens tid.
 */
export const maxDuration = 60;

export const metadata = { title: "Kalender" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * /kalender.
 *
 * =============================================================================
 * LEVERANSKALENDERN ÄR HUVUDVYN SEDAN 0069
 *
 * Beställarens beslut 2026-09-30 (DECISIONS.md D-K1, D-K2): kalendern bokar
 * möten och ser ut som prototypen i `docs/leveranskalender/`. Planeringsvyn —
 * listan till vänster och dagen till höger — står kvar oförändrad under
 * `?vy=planera` och `?vy=planvecka`, med en länk i kalenderns sidolista.
 *
 * Adressen bär `vy`, `dag` och `visa` (kalendrarna utöver den egna), så att
 * vyn överlever en omladdning och går att dela. `handelse` kommer från en
 * notis och öppnar panelen direkt.
 * =============================================================================
 */
export default async function Kalendersidan({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  if (sp.vy === "planera" || sp.vy === "planvecka") {
    return <Planeringssidan sp={sp} />;
  }

  const user = await getCurrentUser();
  if (!user?.employee) {
    return (
      <EmptyState
        rubrik="Kalender"
        text="Ditt konto är inte kopplat till en anställd än, så det finns ingen kalender att visa."
      />
    );
  }

  const idag = svensktDatum();
  const vyIAdressen = arVy(sp.vy);
  const vy = arVy(sp.vy) ? sp.vy : "arbetsvecka";
  const dag = arDatum(sp.dag) ? sp.dag : hemdag(idag);
  // `?person=` är den gamla adressen till en kollegas kalender. Den visas nu
  // bredvid den egna, som en ikryssad kalender.
  const lista = typeof sp.visa === "string" ? sp.visa : typeof sp.person === "string" ? sp.person : "";
  const visa = lista.split(",").filter((id) => UUID.test(id));
  const oppna = typeof sp.handelse === "string" && UUID.test(sp.handelse) ? sp.handelse : null;

  const data = await hamtaLeveranskalender(user, vy, dag, visa, idag);
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <h1 className="sr-only">Kalender</h1>
      <Leveranskalender data={data} vyIAdressen={vyIAdressen} oppna={oppna} />
    </div>
  );
}
