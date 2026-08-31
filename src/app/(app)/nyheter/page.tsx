import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { narTid } from "@/lib/notiser";
import { GuideVard } from "@/components/guide/GuideVard";

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

  const [{ data: inlagg }, { data: personer }, { data: team }] = await Promise.all([
    supabase
      .from("news_post")
      .select("id, slug, title, body_md, status, pinned, audience_roles, audience_teams, published_at, author_id")
      .neq("status", "archived")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false, nullsFirst: true })
      .limit(50),
    supabase.from("employee").select("id, first_name, last_name"),
    supabase.from("team").select("id, name"),
  ]);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const teamnamn = new Map((team ?? []).map((t) => [t.id, t.name]));
  const lista = inlagg ?? [];

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
    </div>
  );
}
