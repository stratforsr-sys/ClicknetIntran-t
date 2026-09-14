import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Ikon } from "@/components/shell/Ikon";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { arStangd, forsenad } from "@/lib/uppgifter";
import { hamtaDelningar, hamtaEgenKalender, hamtaKollegasKalender } from "@/lib/kalender-server";
import type { Uppgift } from "@/lib/uppgifter-server";
import {
  NIVA_ETIKETT,
  dagKort,
  dagPlus,
  dagrubrik,
  serRubrik,
  veckansDagar,
  veckonummer,
  veckostart,
  type Kalenderpost,
} from "@/lib/kalender";
import { Planeringsvy, type Planerbar } from "./Planeringsvy";
import { Veckovy } from "./Veckovy";
import { Plingknapp } from "./Plingknapp";

export const dynamic = "force-dynamic";

export const metadata = { title: "Kalender" };

/**
 * Kalendern — pass 2 av uppgiftsmodulen.
 *
 * =============================================================================
 * PLANERINGSVYN ÄR HUVUDVYN, OCH DET ÄR BESTÄLLARENS BESLUT MED ETT SKÄL BAKOM
 *
 * En vanlig kalender öppnas för att man vill VETA något — när är mötet, är hon
 * ledig på torsdag. Den här öppnas för att man vill BESTÄMMA något: vad av allt
 * jag har att göra ska ske i dag, och ryms det?
 *
 * Därför står listan till vänster och dagen till höger, och därför är det enda
 * som händer på sidan att man flyttar något från den ena till den andra. Det är
 * Sunsamas grepp, och det vilar på samma fynd som bar hela pass 1: en uppgift
 * med ett utskrivet NÄR blir gjord ungefär dubbelt så ofta som en utan
 * (Gollwitzer, d = 0,65 över 94 studier). Ett datum är ett halvt NÄR. Ett
 * klockslag är hela.
 *
 * VECKAN ÄR EN ANDRAVY och inte en likvärdig. Den svarar på "hur ser veckan
 * ut", vilket är en fråga man ställer en gång i veckan — och den går inte att
 * planera i, eftersom en vecka i sju kolumner inte har plats för ett rutnät
 * man träffar med musen.
 *
 * TILLSTÅNDET LIGGER I ADRESSEN och inte i React. `?dag=`, `?vy=` och
 * `?person=` gör dagen bokmärkbar och delbar, och — viktigare — gör att
 * `revalidatePath("/kalender")` efter en `planera()` faktiskt ritar om den dag
 * man står på. Med dagen i en useState hade varje omplanering hoppat till idag.
 * =============================================================================
 */
export default async function Kalendersidan({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) {
    return (
      <EmptyState
        rubrik="Kalender"
        text="Ditt konto är inte kopplat till en anställd än, så det finns ingen kalender att visa."
      />
    );
  }

  const sp = await searchParams;
  const idag = svensktDatum();

  const dag = laesDatum(sp.dag) ?? idag;
  const vy = sp.vy === "vecka" ? "vecka" : "dag";
  const person = typeof sp.person === "string" && sp.person !== user.employee.id ? sp.person : null;

  const dagar = vy === "vecka" ? veckansDagar(dag) : [dag];
  const fran = dagar[0];
  const till = dagar[dagar.length - 1];

  /**
   * DEN EGNA KALENDERN HÄMTAS INTE NÄR MAN TITTAR PÅ NÅGON ANNANS. Sex frågor
   * för data som inte ritas är sex frågor användaren står och väntar på.
   */
  const [egen, kollega, delningar] = await Promise.all([
    person ? Promise.resolve(null) : hamtaEgenKalender(user, fran, till),
    person ? hamtaKollegasKalender(user, person, fran, till) : Promise.resolve(null),
    hamtaDelningar(user),
  ]);

  const poster: Kalenderpost[] = person ? (kollega?.poster ?? []) : (egen?.poster ?? []);
  const kollegansNamn = person ? (delningar.kollegor.find((k) => k.id === person)?.namn ?? "Kollegan") : null;

  const projekt = Object.fromEntries(
    (egen?.bild.projekt ?? []).map((p) => [p.id, { namn: p.name, farg: p.color }]),
  );

  return (
    <div className="flex flex-col gap-6 pt-2">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-display text-ink-900">
            {person ? `${kollegansNamn}s kalender` : "Kalender"}
          </h1>
          <p className="text-body text-ink-500">
            {person
              ? kollega
                ? NIVA_ETIKETT[kollega.niva].replace("Kan se", "Du ser")
                : "Du ser ingenting av den här kalendern."
              : "Din lista till vänster, dagen till höger. Dra en uppgift till ett klockslag."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!person && <Plingknapp />}
          <Link
            href="/kalender/delning"
            className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-small text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
          >
            <Ikon namn="personal" className="size-4" />
            Delning
          </Link>
        </div>
      </header>

      <Card className="flex flex-col gap-4">
        <Styrraden dag={dag} idag={idag} vy={vy} person={person} />

        {person && !kollega && (
          <p className="rounded-sm bg-canvas px-4 py-3 text-small text-ink-500">
            Personen finns inte, eller har slutat. Kalendern är stängd.
          </p>
        )}

        {person ? (
          <Kollegavy poster={poster} dagar={dagar} idag={idag} niva={kollega?.niva ?? null} />
        ) : vy === "vecka" ? (
          <Veckovy poster={poster} dagar={dagar} idag={idag} />
        ) : (
          <Planeringsvy
            dag={dag}
            idag={idag}
            poster={poster}
            attPlanera={attPlanera(egen?.bild.uppgifter ?? [], user.employee.id, idag, dag)}
            projekt={projekt}
          />
        )}
      </Card>

      {delningar.kollegor.length > 0 && !person && (
        <section className="flex flex-col gap-2">
          <h2 className="text-h2 text-ink-900">Kollegornas kalendrar</h2>
          <p className="text-small text-ink-500">
            Alla ser när alla är upptagna. Vad tiden gäller ser du bara om personen delat mer än så.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {delningar.kollegor.map((k) => {
              const niva = delningar.inat.find((i) => i.employee_id === k.id)?.niva ?? null;
              return (
                <Link
                  key={k.id}
                  href={`/kalender?person=${k.id}&dag=${dag}&vy=${vy}`}
                  className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-small text-ink-700 shadow-elev-1 transition-colors duration-fast hover:text-brand-700"
                >
                  {k.namn}
                  {serRubrik(niva) && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-micro text-brand-700">
                      delad
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Dagnavigering och vyval.
 *
 * "Idag" STÅR ALLTID FRAMME, även när man redan är där. En knapp som försvinner
 * när den inte behövs tvingar den som gått vilse i november att räkna sig
 * tillbaka — och det är just den personen knappen finns för.
 */
function Styrraden({
  dag,
  idag,
  vy,
  person,
}: {
  dag: string;
  idag: string;
  vy: "dag" | "vecka";
  person: string | null;
}) {
  const del = person ? `&person=${person}` : "";
  const steg = vy === "vecka" ? 7 : 1;
  const rubrik =
    vy === "vecka"
      ? `Vecka ${veckonummer(dag)} · ${dagKort(veckostart(dag))}–${dagKort(dagPlus(veckostart(dag), 6))}`
      : dagrubrik(dag, idag);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <Pil href={`/kalender?dag=${dagPlus(dag, -steg)}&vy=${vy}${del}`} riktning="bak" />
        <h2 className="tnum min-w-[12rem] px-1 text-h2 text-ink-900">{rubrik}</h2>
        <Pil href={`/kalender?dag=${dagPlus(dag, steg)}&vy=${vy}${del}`} riktning="fram" />
        <Link
          href={`/kalender?dag=${idag}&vy=${vy}${del}`}
          className="ml-2 rounded-full px-3 py-1.5 text-small text-ink-500 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
        >
          Idag
        </Link>
      </div>

      <div role="group" aria-label="Vy" className="flex gap-1 rounded-full bg-canvas p-1">
        {(["dag", "vecka"] as const).map((v) => (
          <Link
            key={v}
            href={`/kalender?dag=${dag}&vy=${v}${del}`}
            aria-current={vy === v ? "page" : undefined}
            className={
              vy === v
                ? "rounded-full bg-surface px-4 py-1.5 text-small font-semibold text-ink-900 shadow-elev-1"
                : "rounded-full px-4 py-1.5 text-small text-ink-500 transition-colors duration-fast hover:text-ink-900"
            }
          >
            {v === "dag" ? "Planera" : "Vecka"}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Pil({ href, riktning }: { href: string; riktning: "bak" | "fram" }) {
  return (
    <Link
      href={href}
      aria-label={riktning === "bak" ? "Föregående" : "Nästa"}
      className="rounded-full p-2 text-ink-500 transition-colors duration-fast hover:bg-canvas hover:text-brand-700"
    >
      <Ikon namn={riktning === "bak" ? "tillbaka" : "fram"} className="size-4" />
    </Link>
  );
}

/**
 * Kollegans dagar — läsvy, aldrig planeringsvy.
 *
 * INGEN GRIDD OCH INGEN DRAGNING, oavsett nivå. Att flytta någon annans uppgift
 * är något man gör på uppgiftssidan, där rubriken och kretsen syns — inte genom
 * att dra i en vy som per konstruktion visar mindre än vad som finns. Den som
 * har nivå fyra ser knappen där hon ska se den.
 */
function Kollegavy({
  poster,
  dagar,
  idag,
  niva,
}: {
  poster: Kalenderpost[];
  dagar: string[];
  idag: string;
  niva: string | null;
}) {
  if (!niva) return null;

  return (
    <div className="flex flex-col gap-4">
      {dagar.map((d) => {
        const dagens = poster
          .filter((p) => p.dag === d)
          .sort((a, b) => (a.tid ?? "99:99").localeCompare(b.tid ?? "99:99"));

        return (
          <div key={d} className="flex flex-col gap-2">
            <h3 className={d === idag ? "text-h2 text-brand-700" : "text-h2 text-ink-900"}>
              {dagrubrik(d, idag)}
            </h3>
            {dagens.length === 0 ? (
              <p className="text-small text-ink-300">Inget inlagt.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {dagens.map((p) => (
                  <li key={p.id} className="flex items-baseline gap-3 rounded-sm bg-canvas px-3 py-2">
                    <span className="tnum w-14 shrink-0 text-small text-ink-500">
                      {p.tid ?? "Hela dagen"}
                    </span>
                    {/*
                      NULL RUBRIK ÄR GRUNDLÄGET, inte ett fel. Posten finns, och
                      det enda som lämnats ut är att tiden är tagen — se
                      `kalender_poster()` i 0057.
                    */}
                    <span className={p.rubrik ? "text-body text-ink-900" : "text-body text-ink-500 italic"}>
                      {p.rubrik ?? "Upptagen"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Vad som ligger i vänsterspalten.
 *
 * ALLT ÖPPET SOM INTE REDAN HAR ETT KLOCKSLAG PÅ DEN VALDA DAGEN. Tre grupper,
 * och ordningen är ett påstående om vad man ska ta först: det som redan gått
 * över tiden, det som saknar dag helt, och sedan det som ligger framåt.
 *
 * DET SOM REDAN LIGGER I RUTNÄTET STÅR INTE HÄR. En uppgift som syns på två
 * ställen samtidigt får den som drar den att undra vilken av dem som gäller.
 */
function attPlanera(uppgifter: readonly Uppgift[], mig: string, idag: string, dag: string): Planerbar[] {
  const mina = uppgifter.filter((u) => {
    const min = u.assignee_id === mig || (u.assignee_id === null && u.created_by === mig);
    if (!min || arStangd(u.lage)) return false;
    // Redan utlagd på den här dagen? Då står den i rutnätet i stället.
    return !(u.due_date === dag && u.due_time);
  });

  const vikt = (u: Uppgift) => {
    if (forsenad(u, idag)) return 0;
    if (!u.due_date) return 1;
    return 2;
  };

  return [...mina]
    .sort((a, b) => {
      const v = vikt(a) - vikt(b);
      if (v !== 0) return v;
      const da = a.due_date ?? "9999-12-31";
      const db = b.due_date ?? "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.title.localeCompare(b.title, "sv");
    })
    // Fyrtio räcker. En vänsterspalt man skrollar i är en spalt man slutar
    // planera ur — resten finns kvar på /uppgifter, som är listans hemvist.
    .slice(0, 40)
    .map((u) => ({
      id: u.id,
      title: u.title,
      project_id: u.project_id,
      due_date: u.due_date,
      due_time: u.due_time,
      estimate_minutes: u.estimate_minutes,
      priority: u.priority,
      forsenad: forsenad(u, idag),
    }));
}

/** "2026-09-14" eller inget. En trasig parameter ska ge idag, inte ett fel. */
function laesDatum(varde: string | string[] | undefined): string | null {
  if (typeof varde !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(varde)) return null;
  return Number.isNaN(Date.parse(`${varde}T12:00:00Z`)) ? null : varde;
}
