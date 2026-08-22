import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { MALLSTATUS_ETIKETT, type Mallstatus } from "@/lib/avtal";
import { Redaktor } from "../Redaktor";
import { sattMallstatus } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * E9.1. Redigera en mall.
 *
 * En publicerad mall gar att redigera, och det ar med flit: avtalen som redan
 * ar utfardade bar sin egen frysta text (0028), sa en andring har kan inte na
 * dem. Det ar hela poangen med att frysa — annars hade varje stavfelsrattning
 * kravt att mallen arkiverades och skrevs om.
 */
export default async function RedigeraMall({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin")) notFound();

  const supabase = await supabaseServer();
  const { data: mall } = await supabase
    .from("contract_template")
    .select("id, slug, title, body_md, employment_type, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!mall) notFound();

  const status = mall.status as Mallstatus;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge ton={status === "published" ? "ok" : status === "draft" ? "warn" : "neutral"}>
            {MALLSTATUS_ETIKETT[status]}
          </Badge>
          <span className="text-small text-ink-500">
            {status === "published"
              ? "Går att skapa avtal ur."
              : "Publicera mallen för att kunna skapa avtal ur den."}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {status !== "published" && (
            <form action={sattMallstatus}>
              <input type="hidden" name="mall_id" value={mall.id} />
              <input type="hidden" name="status" value="published" />
              <Button type="submit" variant="sekundar" size="sm">
                Publicera
              </Button>
            </form>
          )}
          {status === "published" && (
            <form action={sattMallstatus}>
              <input type="hidden" name="mall_id" value={mall.id} />
              <input type="hidden" name="status" value="archived" />
              <Button type="submit" variant="diskret" size="sm">
                Arkivera
              </Button>
            </form>
          )}
          {status === "archived" && (
            <form action={sattMallstatus}>
              <input type="hidden" name="mall_id" value={mall.id} />
              <input type="hidden" name="status" value="draft" />
              <Button type="submit" variant="diskret" size="sm">
                Tillbaka till utkast
              </Button>
            </form>
          )}
        </div>
      </Card>

      <Redaktor mall={mall} />
    </div>
  );
}
