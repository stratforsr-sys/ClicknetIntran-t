import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { publiceraNyhet, arkiveraNyhet } from "../actions";

export const dynamic = "force-dynamic";

export default async function NyhetSida({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: inlagg } = await supabase
    .from("news_post")
    .select("id, slug, title, body_md, status, pinned, audience_roles, audience_teams, published_at, author_id")
    .eq("slug", slug)
    .maybeSingle();

  // AC-5.9:s princip gäller även här: den som inte är i målgruppen får 404 och
  // inte "åtkomst nekad". Ett nekande bekräftar att inlägget finns, och rubriken
  // kan i sig vara uppgiften man inte skulle ha.
  if (!inlagg) notFound();

  const [{ data: forfattare }, { data: team }] = await Promise.all([
    supabase
      .from("employee")
      .select("first_name, last_name")
      .eq("id", inlagg.author_id)
      .maybeSingle(),
    supabase.from("team").select("id, name"),
  ]);

  const teamnamn = new Map((team ?? []).map((t) => [t.id, t.name]));
  const farSkriva = hasRole(user, "sales_manager", "ceo", "admin");
  const roller = (inlagg.audience_roles ?? []) as Role[];
  const teams = (inlagg.audience_teams ?? []) as string[];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/nyheter"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Alla nyheter
      </Link>

      <Card status={inlagg.pinned ? "brand" : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {inlagg.pinned && <Badge ton="brand">Viktigt</Badge>}
          {inlagg.status === "draft" && <Badge ton="warn">Utkast — syns bara för dig</Badge>}
          {inlagg.status === "archived" && <Badge ton="neutral">Arkiverat</Badge>}
        </div>

        <h1 className="mt-2 text-display text-ink-900">{inlagg.title}</h1>

        <p className="mt-1 text-small text-ink-500">
          {forfattare ? fullName(forfattare) : "Ledningen"}
          {inlagg.published_at &&
            ` · ${new Date(inlagg.published_at).toLocaleDateString("sv-SE", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}`}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-small text-ink-500">Till:</span>
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

        {/* AC-5.10:s radlängd gäller allt som ska läsas, inte bara rutiner. */}
        <div className="mt-6 max-w-[70ch]">
          <Markdown text={inlagg.body_md} />
        </div>

        {farSkriva && (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-canvas pt-5">
            {inlagg.status !== "published" && (
              <form action={publiceraNyhet}>
                <input type="hidden" name="nyhet_id" value={inlagg.id} />
                <Button type="submit" size="sm">
                  Publicera
                </Button>
              </form>
            )}
            {inlagg.status === "published" && (
              <form action={arkiveraNyhet}>
                <input type="hidden" name="nyhet_id" value={inlagg.id} />
                <Button type="submit" variant="sekundar" size="sm">
                  Arkivera
                </Button>
              </form>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
