import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { NyttTeam } from "./NyttTeam";
import { sparaTeam, taBortTeam } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team — Clicknet Nav" };

/**
 * E1.13. Teamet styr mer an rubriken i en lista: `leads_employee()` i
 * databasen slapper in teamledaren pa medlemmarnas rader. Sidan visar darfor
 * medlemmarna rakt upp och ner, sa att den som satter en ledare ser exakt
 * vilka personuppgifter hen just gav bort.
 */
export default async function TeamSida() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user)) redirect("/personal");

  const supabase = await supabaseServer();

  const [{ data: team }, { data: anstallda }] = await Promise.all([
    supabase.from("team").select("id, name, lead_id").order("name"),
    supabase
      .from("employee")
      .select("id, first_name, last_name, team_id, status")
      .neq("status", "offboarded")
      .order("first_name"),
  ]);

  const lista = team ?? [];
  const personer = anstallda ?? [];
  const utanTeam = personer.filter((p) => !p.team_id);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/personal"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till personal
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Team</h1>
          <p className="mt-1 text-body text-ink-500">
            {lista.length} {lista.length === 1 ? "team" : "team"}
            {utanTeam.length > 0 && ` · ${utanTeam.length} utan team`}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          {lista.length === 0 ? (
            <EmptyState
              rubrik="Inga team än"
              text="Ett team ger teamledaren insyn i sina medlemmars uppgifter. Skapa det första i rutan intill."
            />
          ) : (
            lista.map((t) => {
              const medlemmar = personer.filter((p) => p.team_id === t.id);
              return (
                <Card key={t.id}>
                  <form action={sparaTeam} className="flex flex-col gap-4">
                    <input type="hidden" name="team_id" value={t.id} />

                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                        <span className="text-small font-semibold text-ink-700">Namn</span>
                        <input
                          name="namn"
                          defaultValue={t.name}
                          required
                          className={KONTROLL}
                        />
                      </label>

                      <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                        <span className="text-small font-semibold text-ink-700">Teamledare</span>
                        <select
                          name="lead_id"
                          defaultValue={t.lead_id ?? ""}
                          className={`${KONTROLL} appearance-none pr-10`}
                        >
                          <option value="">Ingen ledare</option>
                          {personer.map((p) => (
                            <option key={p.id} value={p.id}>
                              {fullName(p)}
                            </option>
                          ))}
                        </select>
                      </label>

                      <Button type="submit" size="sm">
                        Spara
                      </Button>
                    </div>
                  </form>

                  <div className="mt-4 border-t border-ink-300/30 pt-4">
                    <p className="mb-2 text-micro uppercase text-ink-500">
                      {medlemmar.length} {medlemmar.length === 1 ? "medlem" : "medlemmar"}
                    </p>
                    {medlemmar.length === 0 ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-small text-ink-500">
                          Tomt team. Medlemmar kopplas på personens egen sida.
                        </p>
                        <form action={taBortTeam}>
                          <input type="hidden" name="team_id" value={t.id} />
                          <Button type="submit" variant="diskret" size="sm">
                            Ta bort teamet
                          </Button>
                        </form>
                      </div>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {medlemmar.map((m) => (
                          <li key={m.id}>
                            <Link
                              href={`/personal/${m.id}`}
                              className="inline-flex min-h-9 items-center gap-2 rounded-full bg-canvas px-3 text-small text-ink-700 hover:bg-surface-alt hover:text-ink-900"
                            >
                              {fullName(m)}
                              {m.id === t.lead_id && <Badge ton="brand">Ledare</Badge>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="h-fit">
            <CardHeader titel="Nytt team" />
            <NyttTeam />
          </Card>

          {utanTeam.length > 0 && (
            <Card className="h-fit">
              <CardHeader
                titel="Utan team"
                beskrivning="Ingen teamledare ser deras uppgifter."
              />
              <ul className="flex flex-wrap gap-2">
                {utanTeam.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/personal/${p.id}`}
                      className="inline-flex min-h-9 items-center rounded-full bg-canvas px-3 text-small text-ink-700 hover:bg-surface-alt hover:text-ink-900"
                    >
                      {fullName(p)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
