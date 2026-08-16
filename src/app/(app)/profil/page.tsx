import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { kraverMfa, harVerifieradFaktor } from "@/lib/mfa";
import {
  ROLE_LABEL,
  PERMISSION_LABEL,
  EMPLOYMENT_TYPE_LABEL,
  STATUS_LABEL,
} from "@/lib/roles";
import { Mfa } from "./Mfa";
import { Losenord } from "./Losenord";

export const metadata = { title: "Min profil — Clicknet Nav" };

/** E1.14: var och en ser sina egna uppgifter och sköter sin egen inloggning. */
export default async function ProfilSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: team } = user.employee.team_id
    ? await supabase.from("team").select("name").eq("id", user.employee.team_id).maybeSingle()
    : { data: null };

  const harFaktor = harVerifieradFaktor(user);
  const obligatorisk = kraverMfa(user);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Min profil</h1>
        <p className="mt-1 text-body text-ink-500">
          Dina uppgifter och din inloggning. Behöver något i listan ändras, säg till din chef.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Inloggning" beskrivning="Lösenordet byter du själv, när som helst." />
            <Losenord />
          </Card>

          <Card status={obligatorisk && !harFaktor ? "danger" : undefined}>
            <CardHeader
              titel="Tvåfaktor"
              beskrivning={
                obligatorisk
                  ? "Din roll når känsliga uppgifter. Därför är tvåfaktor obligatoriskt."
                  : "Ett extra steg vid inloggning. Rekommenderas."
              }
            />
            <Mfa harFaktor={harFaktor} obligatorisk={obligatorisk} />
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader titel="Mina uppgifter" />
          <dl className="flex flex-col gap-3">
            <Rad etikett="Namn" varde={fullName(user.employee)} />
            <Rad etikett="E-post" varde={user.email} />
            <Rad etikett="Team" varde={team?.name ?? "Inget team"} />
            <Rad
              etikett="Anställning"
              varde={
                EMPLOYMENT_TYPE_LABEL[user.employee.employment_type] ??
                user.employee.employment_type
              }
            />
            <Rad
              etikett="Startdatum"
              varde={user.employee.start_date ?? "Inte satt"}
            />
            <div>
              <dt className="text-micro uppercase text-ink-500">Roller</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {user.roles.length ? (
                  user.roles.map((r) => (
                    <Badge key={r} ton="brand">
                      {ROLE_LABEL[r]}
                    </Badge>
                  ))
                ) : (
                  <Badge ton="warn">Väntar på roll</Badge>
                )}
                {user.permissions.map((p) => (
                  <Badge key={p} ton="accent">
                    {PERMISSION_LABEL[p]}
                  </Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-ink-500">Status</dt>
              <dd className="mt-1.5">
                <Badge ton={user.employee.status === "active" ? "ok" : "warn"}>
                  {STATUS_LABEL[user.employee.status] ?? user.employee.status}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="mt-0.5 text-body text-ink-900">{varde}</dd>
    </div>
  );
}
