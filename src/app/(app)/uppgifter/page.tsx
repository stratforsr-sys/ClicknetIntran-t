import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Sektionsflikar, TomFlik } from "@/components/ui/Flikar";
import { getCurrentUser } from "@/lib/auth";
import { arStangd, forsenad, tidstext } from "@/lib/uppgifter";
import {
  attGranska,
  hamtaUppgiftsbild,
  inkorgen,
  minaIdag,
  minaOppna,
  stilla,
  vantarPaAndra,
  type Uppgift,
} from "@/lib/uppgifter-server";
import { Lista, type Listrad, type Projektkarta } from "./Lista";
import { Snabbrad } from "./Snabbrad";
import { NyttProjekt } from "./NyttProjekt";

export const dynamic = "force-dynamic";

export const metadata = { title: "Uppgifter" };

/**
 * Uppgiftsmodulens huvudsida.
 *
 * ===========================================================================
 * SEX VYER ÖVER SAMMA DATA, OCH ORDNINGEN ÄR ETT PÅSTÅENDE
 *
 * "Idag" står först för att det är den enda vyn som svarar på frågan man
 * faktiskt har på morgonen. "Väntar på andra" står före "Att granska" för att
 * det man lämnat ifrån sig är det man själv slutar tänka på — GTD kallar den
 * listan "Waiting For", och för en chef är den modulens mest värdefulla sida.
 *
 * "Alla" står i mitten och inte först, med flit. En lista med allt är en lista
 * man skrollar i stället för att beta av.
 *
 * SIFFERRADEN ÖVERST BÄR FYRA TAL och bara de fyra som kräver att någon gör
 * något. Klara uppgifter räknas inte där — ett tal som bara växer är en affisch.
 * ===========================================================================
 */
export default async function Uppgiftssidan({
  searchParams,
}: {
  searchParams: Promise<{ projekt?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) {
    return (
      <EmptyState
        rubrik="Uppgifter"
        text="Ditt konto är inte kopplat till en anställd än, så det finns inga uppgifter att visa."
      />
    );
  }

  const mig = user.employee.id;
  const bild = await hamtaUppgiftsbild(user);
  const idag = bild.idag;

  /**
   * Projektfiltret.
   *
   * ETT FILTER OCH INTE EN EGEN SIDA. Projektkortet leder hit med ?projekt=,
   * och samtliga sex vyer smalnar av samtidigt — "vad vantar pa mig i massan"
   * och "vad har jag delegerat i massan" ar samma fragor som alltid, stallda om
   * en mindre mangd. En egen projektsida hade behovt bygga om alla sex, och den
   * dag de gled isar hade tva stallen svarat olika pa samma fraga.
   */
  const { projekt: valtProjekt } = await searchParams;
  const valt = valtProjekt ? bild.projekt.find((p) => p.id === valtProjekt) : null;
  const vy = valt
    ? { ...bild, uppgifter: bild.uppgifter.filter((u) => u.project_id === valt.id) }
    : bild;

  const namn: Record<string, string> = Object.fromEntries(bild.namn);

  const projektkarta: Projektkarta = Object.fromEntries(
    bild.projekt.map((p) => [p.id, { namn: p.name, farg: p.color }]),
  );

  const idagsrader = minaIdag(vy, mig);
  const oppna = minaOppna(vy, mig);
  const vantande = vantarPaAndra(vy, mig);
  const granskningar = attGranska(vy, mig);
  const inkorg = inkorgen(vy, mig);
  const forsenade = idagsrader.filter((u) => forsenad(u, idag));

  /**
   * Klara uppgifter kapas vid trettio.
   *
   * Listan finns för att kunna gå tillbaka och se vad som gjordes, inte för att
   * vara ett arkiv — och ett arkiv utan sökning är en lista ingen läser till
   * slut. Trettio räcker för "vad gjorde jag den här månaden".
   */
  const klara = vy.uppgifter.filter((u) => u.assignee_id === mig && arStangd(u.lage)).slice(0, 30);

  const till = (u: Uppgift): Listrad => ({
    id: u.id,
    title: u.title,
    assignee_id: u.assignee_id,
    project_id: u.project_id,
    due_date: u.due_date,
    due_time: u.due_time,
    estimate_minutes: u.estimate_minutes,
    priority: u.priority,
    lage: u.lage,
    granskare: u.granskare,
    kopplingar: u.kopplingar.map((k) => ({ etikett: k.etikett, slag: k.slag })),
    delar: u.delar.map((d) => ({ id: d.id, title: d.title, lage: d.lage })),
  });

  /** Summan under "Idag". Se rubriken i `Dagsumma` längre ned. */
  const planeradeMinuter = idagsrader.reduce((s, u) => s + (u.estimate_minutes ?? 0), 0);

  const aktivaProjekt = bild.projekt.filter((p) => !p.archived_at);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <header className="flex flex-col gap-1">
        <h1 className="text-display text-ink-900">{valt ? valt.name : "Uppgifter"}</h1>
        <p className="text-body text-ink-500">
          {oppna.length === 0
            ? "Ingenting öppet just nu."
            : `${oppna.length} öppna, varav ${idagsrader.length} idag.`}
        </p>
        {valt && (
          <Link href="/uppgifter" className="mt-1 self-start text-small font-semibold text-brand-700 hover:underline">
            ← Visa alla uppgifter
          </Link>
        )}
      </header>

      <Snabbrad projektNamn={aktivaProjekt.map((p) => p.name)} />

      {aktivaProjekt.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-h2 text-ink-900">Projekt</h2>
            <NyttProjekt />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {aktivaProjekt.map((p) => (
              <Projektkort key={p.id} projekt={p} idag={idag} />
            ))}
          </div>
        </section>
      )}

      <Card>
        <Sektionsflikar
          etikett="Vy"
          tal={[
            { id: "forsenade", varde: forsenade.length, etikett: "Försenade", kraverHandling: true },
            { id: "idag", varde: idagsrader.length, etikett: "Idag" },
            { id: "vantar", varde: vantande.length, etikett: "Väntar på andra" },
            { id: "granska", varde: granskningar.length, etikett: "Att granska", kraverHandling: true },
          ]}
          sektioner={[
            {
              id: "idag",
              etikett: "Idag",
              antal: idagsrader.length,
              innehall:
                idagsrader.length === 0 ? (
                  <TomFlik text="Ingenting förfallet och inget med dagens datum. Skriv in nästa sak i fältet överst." />
                ) : (
                  <div className="flex flex-col gap-3">
                    <Lista rader={idagsrader.map(till)} namn={namn} projekt={projektkarta} idag={idag} />
                    <Dagsumma minuter={planeradeMinuter} antal={idagsrader.length} />
                  </div>
                ),
            },
            {
              id: "vantar",
              etikett: "Väntar på andra",
              antal: vantande.length,
              innehall:
                vantande.length === 0 ? (
                  <TomFlik text="Du väntar inte på någon. Det som ligger hos andra hamnar här automatiskt när du lägger en uppgift på dem." />
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-small text-ink-500">
                      Det du lämnat ifrån dig. Siffran är hur länge det stått still — inte hur länge sedan du la
                      upp den.
                    </p>
                    <ul className="-mx-2">
                      {vantande.map((u) => (
                        <Vantarad
                          key={u.id}
                          u={u}
                          namn={namn}
                          dagar={stilla(u, idag)}
                          idag={idag}
                        />
                      ))}
                    </ul>
                  </div>
                ),
            },
            {
              id: "granska",
              etikett: "Att granska",
              antal: granskningar.length,
              innehall:
                granskningar.length === 0 ? (
                  <TomFlik text="Inget väntar på ditt godkännande." />
                ) : (
                  <Lista
                    rader={granskningar.map(till)}
                    namn={namn}
                    projekt={projektkarta}
                    idag={idag}
                    visaAnsvarig
                  />
                ),
            },
            {
              id: "alla",
              etikett: "Alla mina",
              antal: oppna.length,
              innehall:
                oppna.length === 0 ? (
                  <TomFlik text="Inga öppna uppgifter." />
                ) : (
                  <Lista rader={oppna.map(till)} namn={namn} projekt={projektkarta} idag={idag} />
                ),
            },
            {
              id: "inkorg",
              etikett: "Inkorg",
              antal: inkorg.length,
              innehall:
                inkorg.length === 0 ? (
                  <TomFlik text="Inkorgen är tom. Hit hamnar det du skrivit ner utan att peka ut vem som ska göra det." />
                ) : (
                  <Lista rader={inkorg.map(till)} namn={namn} projekt={projektkarta} idag={idag} />
                ),
            },
            {
              id: "klara",
              etikett: "Klara",
              antal: klara.length,
              innehall:
                klara.length === 0 ? (
                  <TomFlik text="Inget avbockat än." />
                ) : (
                  <Lista rader={klara.map(till)} namn={namn} projekt={projektkarta} idag={idag} />
                ),
            },
          ]}
        />
      </Card>

      {bild.uppgifter.length === 0 && aktivaProjekt.length === 0 && (
        <EmptyState
          rubrik="Tomt — och det är rätt läge att börja"
          text="Skriv ner nästa sak du inte vill glömma i fältet överst. Du behöver inte bestämma datum eller ansvarig; det går att lägga till efteråt."
          handling={<NyttProjekt />}
        />
      )}
    </div>
  );
}

/**
 * Summan under dagens lista.
 *
 * VISAS BARA NÄR NÅGOT FAKTISKT ÄR UPPSKATTAT. En rad som säger "0 min
 * planerat" är en tillsägelse om något användaren inte bett om att bli mätt på.
 *
 * Sex timmar är taket den jämförs mot, och det är inte en arbetsdag. En
 * arbetsdag är åtta, men två av dem går åt till möten, avbrott och det som
 * dyker upp — den som planerar åtta timmars uppgifter i en åttatimmarsdag
 * planerar att misslyckas. Talet är samma vägg som Sunsama sätter upp, och det
 * är hela skälet att tidsuppskattningen finns.
 */
function Dagsumma({ minuter, antal }: { minuter: number; antal: number }) {
  if (minuter === 0) return null;

  const tak = 6 * 60;
  const over = minuter > tak;

  return (
    <div className="flex items-baseline justify-between gap-4 rounded-sm bg-canvas px-4 py-3">
      <span className="text-small text-ink-500">
        {antal} {antal === 1 ? "uppgift" : "uppgifter"} idag
      </span>
      <span className={over ? "text-small font-semibold text-warn-ink" : "text-small text-ink-700"}>
        {tidstext(minuter)} planerat{over ? " — mer än en dag rymmer" : " av 6 h"}
      </span>
    </div>
  );
}

function Vantarad({
  u,
  namn,
  dagar,
  idag,
}: {
  u: Uppgift;
  namn: Record<string, string>;
  dagar: number;
  idag: string;
}) {
  const sen = Boolean(u.due_date && u.due_date < idag);

  return (
    <li className="border-b border-canvas last:border-0">
      <Link
        href={`/uppgifter/${u.id}`}
        className="group flex min-h-14 items-center gap-3 px-3 py-3 transition-colors duration-fast hover:bg-surface-alt"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink-900 group-hover:text-brand-700">{u.title}</span>
          <span className="block text-small text-ink-500">
            {namn[u.assignee_id ?? ""] ?? "Okänd"}
            {u.due_date ? ` · frist ${u.due_date}` : ""}
          </span>
        </span>
        <span
          className={
            dagar >= 7 || sen
              ? "tnum shrink-0 rounded-full bg-warn-tint px-3 py-1 text-micro text-warn-ink"
              : "tnum shrink-0 text-small text-ink-500"
          }
        >
          {dagar === 0 ? "idag" : `${dagar} d`}
        </span>
      </Link>
    </li>
  );
}

/**
 * Projektet som kort.
 *
 * ETT KORT OCH INTE EN RAD, på beställarens uttryckliga begäran. Skälet håller
 * även utan den: ett projekt är få till antalet och långlivat, medan en uppgift
 * är många och kortlivad. Kort för det man har tio av, rader för det man har
 * hundra av — blandas formerna slutar båda betyda något.
 *
 * Siffrorna räknas fram ur uppgifterna vid läsning; se `hamtaUppgiftsbild()`.
 */
function Projektkort({
  projekt,
  idag,
}: {
  projekt: { id: string; name: string; color: string; due_date: string | null; antal: number; klara: number; forsenade: number };
  idag: string;
}) {
  const andel = projekt.antal === 0 ? 0 : Math.round((projekt.klara / projekt.antal) * 100);
  const sen = Boolean(projekt.due_date && projekt.due_date < idag && projekt.klara < projekt.antal);

  const STRECK: Record<string, string> = {
    brand: "bg-brand-500",
    info: "bg-info",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };

  return (
    <Link
      href={`/uppgifter?projekt=${projekt.id}`}
      className="lift group flex flex-col gap-3 rounded-md bg-surface p-4 shadow-elev-1 transition-shadow duration-fast"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`size-2.5 rounded-full ${STRECK[projekt.color] ?? "bg-brand-500"}`} />
          <h3 className="text-h2 text-ink-900 group-hover:text-brand-700">{projekt.name}</h3>
        </div>
        {projekt.forsenade > 0 && (
          <span className="tnum shrink-0 rounded-full bg-danger-tint px-2 py-0.5 text-micro text-danger-ink">
            {projekt.forsenade} sen
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
          <div
            className={`h-full rounded-full transition-[width] duration-fast ${STRECK[projekt.color] ?? "bg-brand-500"}`}
            style={{ width: `${andel}%` }}
          />
        </div>
        <span className="tnum text-small text-ink-500">
          {projekt.klara}/{projekt.antal}
        </span>
      </div>

      {projekt.due_date && (
        <p className={sen ? "text-small text-danger-ink" : "text-small text-ink-500"}>
          Deadline {projekt.due_date}
        </p>
      )}
    </Link>
  );
}
