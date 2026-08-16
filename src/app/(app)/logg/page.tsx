import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import { fullName } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** AC-12.1. Loggen ar lasbar for sales_manager, ceo och admin — RLS avgor. */
const HANDELSE: Record<string, { text: string; ton: "ok" | "warn" | "danger" | "info" | "brand" }> = {
  "employee.created": { text: "Anställd upplagd", ton: "brand" },
  "employee.activated": { text: "Anställd aktiverad", ton: "ok" },
  "employee.offboarded": { text: "Anställning avslutad", ton: "danger" },
  "role.granted": { text: "Roll tilldelad", ton: "info" },
  "role.revoked": { text: "Roll återkallad", ton: "warn" },
  "offboarding.done": { text: "Offboarding kvitterad", ton: "ok" },
  "offboarding.skipped": { text: "Offboarding hoppad", ton: "warn" },
};

export default async function Logg() {
  const supabase = await supabaseServer();

  const { data: rader } = await supabase
    .from("audit_log")
    .select("id, action, object_type, object_id, ts, reason, meta, actor_id")
    .order("ts", { ascending: false })
    .limit(200);

  const { data: personer } = await supabase.from("employee").select("id, first_name, last_name");
  const namnPer = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Händelselogg</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Rollförändringar, kontoändringar och offboarding. Loggen skrivs av systemet och kan inte
          ändras i efterhand.
        </p>
      </div>

      <Card className="p-0 md:p-0">
        {(rader?.length ?? 0) === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik="Inget loggat än"
              text="Så fort någon läggs upp, får en roll eller avslutas hamnar det här."
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {(rader ?? []).map((r) => {
              const h = HANDELSE[r.action] ?? { text: r.action, ton: "neutral" as const };
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas px-6 py-4 last:border-0"
                >
                  <time className="tnum w-40 shrink-0 text-small text-ink-500">
                    {new Date(r.ts).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                  </time>
                  <Badge ton={h.ton}>{h.text}</Badge>
                  <span className="flex-1 text-small text-ink-700">
                    {namnPer.get(String(r.object_id)) ?? r.object_id}
                    {r.meta && typeof r.meta === "object" && "roll" in r.meta
                      ? ` · ${(r.meta as { roll: string }).roll}`
                      : ""}
                  </span>
                  <span className="text-small text-ink-500">
                    av {r.actor_id ? (namnPer.get(r.actor_id) ?? "okänd") : "systemet"}
                  </span>
                  {r.reason && <p className="w-full text-small text-ink-500">Motivering: {r.reason}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
