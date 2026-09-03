import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Markdown } from "@/components/Markdown";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { notisId } from "@/lib/notiser";
import { hamtaNavnyhet, navnyheterFor } from "@/navnyheter";
import { markeraNavnyhetLast } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * En post ur navets släpplista (`src/navnyheter/`).
 *
 * Ligger under /nyheter/nav/ och inte under /nyheter/[slug], eftersom det andra
 * är inlägg ur `news_post` och slår upp slugen i databasen. Två sorters innehåll
 * i samma adressrymd hade betytt att ett inlägg och ett släpp kunde slåss om
 * samma slug — och den som förlorar den striden syns aldrig.
 */
export default async function NavnyhetSida({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const nyhet = hamtaNavnyhet(slug);
  if (!nyhet) notFound();

  /**
   * MÅLGRUPPEN AVGÖR ÅTKOMSTEN, ANSTÄLLNINGSDATUMET GÖR DET INTE.
   *
   * `anstalldSedan` skickas med flit inte in här. Den regeln finns för att
   * slippa putta ut en kö med gamla besked till en nyanställd — men den som
   * fått en länk av en kollega ska kunna läsa den ändå. Rollen är däremot ett
   * riktigt nej: samma princip som AC-5.9, alltså 404 och inte "åtkomst
   * nekad", eftersom ett nekande i sig bekräftar att posten finns.
   */
  const minaRoller = navnyheterFor({ roller: user.roles, behorigheter: user.permissions });
  if (!minaRoller.some((n) => n.slug === nyhet.slug)) notFound();

  const supabase = await supabaseServer();
  const { data: kvitto } = await supabase
    .from("notification_dismissed")
    .select("dismissed_at")
    .eq("employee_id", user.employee.id)
    .eq("notice_id", notisId("navnyhet", nyhet.slug))
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/nyheter"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Alla nyheter
      </Link>

      <Card status="brand">
        <div className="flex flex-wrap items-center gap-2">
          <Badge ton="brand">Nytt i navet</Badge>
          {kvitto && <Badge ton="ok">Läst</Badge>}
        </div>

        <h1 className="mt-2 text-display text-ink-900">{nyhet.rubrik}</h1>

        <p className="mt-1 text-small text-ink-500">
          {new Date(`${nyhet.datum}T12:00:00Z`).toLocaleDateString("sv-SE", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-small text-ink-500">Gäller:</span>
          {nyhet.roller.length === 0 ? (
            <Badge ton="neutral">Alla</Badge>
          ) : (
            nyhet.roller.map((r) => (
              <Badge key={r} ton="info">
                {ROLE_LABEL[r] ?? r}
              </Badge>
            ))
          )}
        </div>

        {/* AC-5.10:s radlängd gäller allt som ska läsas. */}
        <div className="mt-6 max-w-[70ch]">
          <Markdown text={nyhet.text} />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-canvas pt-5">
          {nyhet.href && (
            <ButtonLink href={nyhet.href} variant="sekundar" size="sm">
              Öppna
            </ButtonLink>
          )}

          {kvitto ? (
            <p className="text-small text-ink-500">
              Du har markerat den som läst — den ligger under <em>Tidigare nytt i navet</em>.
            </p>
          ) : (
            /*
              Kvitteringen är ett eget klick och inte något som händer av att
              sidan öppnas. Ett besök är inte en läsning: klockan hade i så fall
              tömts av den som klickade fel, och det är hela skillnaden mot den
              gamla "senast sedd"-tidpunkten som slocknade på allt samtidigt.
            */
            <form action={markeraNavnyhetLast}>
              <input type="hidden" name="slug" value={nyhet.slug} />
              <Button type="submit" size="sm">
                Jag har läst det här
              </Button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
