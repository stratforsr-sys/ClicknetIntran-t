import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { narTid, notisId } from "@/lib/notiser";
import { navnyheterFor, tidpunktFor } from "@/navnyheter";
import { GuideVard } from "@/components/guide/GuideVard";
import { markeraNavnyhetLast } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nyheter — Clicknet Nav" };

/**
 * AC-11.2. Nyhetsinlagg med malgruppsstyrning.
 *
 * RLS avgor vad listan innehaller: `news_post_read` gar genom
 * `matches_audience()`, samma funktion som rutinbiblioteket. Sidan filtrerar
 * alltsa ingenting sjalv — den ritar det databasen lamnade ut.
 */
export default async function NyhetsSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const farSkriva = hasRole(user, "sales_manager", "ceo", "admin");
  const supabase = await supabaseServer();

  const [{ data: inlagg }, { data: personer }, { data: team }, { data: avfardade }] = await Promise.all([
    supabase
      .from("news_post")
      .select("id, slug, title, body_md, status, pinned, audience_roles, audience_teams, published_at, author_id")
      .neq("status", "archived")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(50),
    supabase.from("employee").select("id, first_name, last_name"),
    supabase.from("team").select("id, name"),
    // Samma tabell som klockans avfärdning skriver i (0038), läst med
    // användarens egen token — RLS ger bara hennes egna rader. Det är därför
    // "läst" betyder samma sak på båda ställena utan att någon håller dem i takt.
    supabase.from("notification_dismissed").select("notice_id").eq("employee_id", user.employee.id),
  ]);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const teamnamn = new Map((team ?? []).map((t) => [t.id, t.name]));
  const lista = inlagg ?? [];

  /**
   * Navets släpplista. Målgruppen avgörs av `navnyheterFor()`, samma funktion
   * som klockan frågar — se src/navnyheter/index.ts för varför det inte får bli
   * två filter.
   */
  const kvitterade = new Set((avfardade ?? []).map((a) => a.notice_id));
  const navnyheter = navnyheterFor({
    roller: user.roles,
    behorigheter: user.permissions,
    anstalldSedan: user.employee.start_date,
  });
  const olastaNav = navnyheter.filter((n) => !kvitterade.has(notisId("navnyhet", n.slug)));
  const lastaNav = navnyheter.filter((n) => kvitterade.has(notisId("navnyhet", n.slug)));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="nyheter" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div data-guide="nyheter.rubrik">
          <h1 className="text-display text-ink-900">Nyheter</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {farSkriva
              ? "Besked till hela eller delar av organisationen. Ett inlägg utan vald målgrupp når alla."
              : "Besked från ledningen. Du ser det som riktar sig till din roll och ditt team."}
          </p>
        </div>
        {farSkriva && (
          <ButtonLink href="/nyheter/nytt" variant="primar">
            Skriv inlägg
          </ButtonLink>
        )}
      </div>

      {/*
        Navets släpplista, överst och skild från inläggen.

        Två olika saker som båda är "nyheter": inläggen nedanför är skrivna av
        en människa till en målgrupp och står kvar för alltid, det här är vad
        som byggts och försvinner när du sagt att du läst det. Blandade i samma
        lista hade den ena sorten sett ut som den andra — och en post som
        plötsligt försvinner ur en lista där inget annat gör det är förvirrande,
        inte städat.
      */}
      {olastaNav.length > 0 && (
        <section aria-labelledby="nytt-i-navet" className="flex flex-col gap-3">
          <h2 id="nytt-i-navet" className="text-h2 text-ink-900">
            Nytt i navet
          </h2>
          <ul className="flex flex-col gap-3">
            {olastaNav.map((n) => (
              <li key={n.slug}>
                <Card status="brand">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-h2 text-ink-900">
                      <Link href={`/nyheter/nav/${n.slug}`} className="hover:underline">
                        {n.rubrik}
                      </Link>
                    </h3>
                    <Badge ton="brand">Nytt</Badge>
                    <span className="ml-auto text-small text-ink-500">{narTid(tidpunktFor(n))}</span>
                  </div>

                  <p className="mt-2 max-w-[70ch] text-body text-ink-700">{n.ingress}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-small text-ink-500">
                    <span>Nytt i navet</span>
                    {n.roller.length === 0 ? (
                      <Badge ton="neutral">Alla</Badge>
                    ) : (
                      n.roller.map((r) => (
                        <Badge key={r} ton="info">
                          {ROLE_LABEL[r] ?? r}
                        </Badge>
                      ))
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <ButtonLink href={`/nyheter/nav/${n.slug}`} size="sm">
                      Läs
                    </ButtonLink>
                    {/*
                      Knappen finns även här och inte bara inne i inlägget. Den
                      som redan vet vad ändringen är ska inte behöva öppna en
                      sida för att bli av med raden — och den som vill läsa
                      först har knappen kvar under texten.
                    */}
                    <form action={markeraNavnyhetLast}>
                      <input type="hidden" name="slug" value={n.slug} />
                      <Button type="submit" variant="diskret" size="sm">
                        Jag har läst det här
                      </Button>
                    </form>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lista.length === 0 ? (
        <Card guide="nyheter.lista">
          <EmptyState
            rubrik="Inga nyheter än"
            text={
              farSkriva
                ? "Det första inlägget är ofta det som gör att folk börjar titta här."
                : "När ledningen skriver något som gäller dig hamnar det här."
            }
          />
        </Card>
      ) : (
        <ul data-guide="nyheter.lista" className="flex flex-col gap-3">
          {lista.map((n) => {
            const roller = (n.audience_roles ?? []) as Role[];
            const teams = (n.audience_teams ?? []) as string[];
            return (
              <li key={n.id}>
                <Card status={n.pinned ? "brand" : undefined} klickbart>
                  <Link href={`/nyheter/${n.slug}`} className="block">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className="text-h2 text-ink-900">{n.title}</h2>
                      {n.pinned && <Badge ton="brand">Viktigt</Badge>}
                      {n.status === "draft" && <Badge ton="warn">Utkast</Badge>}
                      <span className="ml-auto text-small text-ink-500">
                        {n.published_at ? narTid(n.published_at) : "Ej publicerat"}
                      </span>
                    </div>

                    {/* Ingress ur brodtexten. Markdown renderas inte har — en
                        lista med rubriker och punktlistor i varje kort blir en
                        vagg, och det ar rubriken man valjer pa. */}
                    <p className="mt-2 line-clamp-2 text-body text-ink-700">
                      {n.body_md.replace(/[#*_>`\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-small text-ink-500">
                      <span>{namn.get(n.author_id) ?? "Ledningen"}</span>
                      {roller.length === 0 && teams.length === 0 ? (
                        <Badge ton="neutral">Alla</Badge>
                      ) : (
                        <>
                          {roller.map((r) => (
                            <Badge key={r} ton="info">
                              {ROLE_LABEL[r] ?? r}
                            </Badge>
                          ))}
                          {teams.map((t) => (
                            <Badge key={t} ton="info">
                              {teamnamn.get(t) ?? "Team"}
                            </Badge>
                          ))}
                        </>
                      )}
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Det lästa försvinner ur vägen, inte ur navet.

        Knappen lovar att raden slutar tränga sig fram — inte att beskedet är
        borta. Utan den här listan hade ett felklick varit oåterkalleligt, och
        den som ville läsa om hur något fungerar hade fått leta i en modul i
        stället för där det stod.
      */}
      {lastaNav.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-small text-ink-500 hover:text-ink-900">
            Tidigare nytt i navet ({lastaNav.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2 border-l border-canvas pl-4">
            {lastaNav.map((n) => (
              <li key={n.slug} className="flex flex-wrap items-baseline gap-x-3">
                <Link
                  href={`/nyheter/nav/${n.slug}`}
                  className="text-small font-semibold text-ink-700 hover:text-ink-900 hover:underline"
                >
                  {n.rubrik}
                </Link>
                <span className="text-small text-ink-500">{n.datum}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
