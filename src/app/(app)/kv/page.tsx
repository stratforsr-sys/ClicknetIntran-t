import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaKriterier, hamtaPolicyer, hamtaSamtal, type Samtalsrad } from "@/lib/kv-server";
import {
  gallandePolicy,
  konfigurationsfel,
  kurvaPerOmrade,
  kvManad,
  troskelIProcent,
  veckorFor,
  type KvKriterium,
  type KvPolicy,
} from "@/lib/kv";
import { hamtaNivaer } from "@/lib/bonus-server";
import { hamtaOrderFor } from "@/lib/order-server";
import { raknaUnderlag } from "@/lib/provision-motor";
import { kronor, manadFore, manadsnamn, manadsnyckel } from "@/lib/provision";
import { Registrera } from "./Registrera";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";

/**
 * E13 steg 5: K&V-protokollet.
 *
 * TVA VYER I EN SIDA, och skillnaden ar vem som tittar.
 *
 * CHEFEN far ett RUTNAT saljare x vecka (avsnitt 6.6). Poangen med rutnatet ar
 * de TOMMA rutorna: en vecka utan bedomning hoppas over och raknas varken for
 * eller emot, sa den enda som ser att den saknas ar den som tittar pa rutnatet.
 *
 * SALJAREN far sina egna veckor, sin utvecklingskurva per omrade och
 * K&V-BONUSEN. Bonusen visas HAR och inte i progressvyn pa /provision — den hor
 * ihop med bedomningen, inte med ordervolymen (avsnitt 9.1).
 */
export default async function KvSida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const bedomare = hasRole(user, "sales_manager", "ceo");
  const chef = hasRole(user, "sales_manager", "ceo", "finance");

  const manad = manadsnyckel();
  const treManaderBak = manadFore(manad, 2);

  const [samtal, kriterier, policyer, personer, minaOrder, nivaer] = await Promise.all([
    hamtaSamtal(treManaderBak),
    hamtaKriterier(),
    hamtaPolicyer(),
    chef ? hamtaSaljare() : Promise.resolve([] as { id: string; namn: string }[]),
    hamtaOrderFor(user.employee.id, manad),
    hamtaNivaer(),
  ]);

  const policy = gallandePolicy(policyer, manad);
  const fel = policy ? konfigurationsfel(kriterier, policy) : null;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="kv-protokollet" />
      <div data-guide="kv.rubrik">
        <h1 className="text-display text-ink-900">K&amp;V</h1>
        <p className="mt-1 text-body text-ink-500">
          Två samtal i veckan, bedömda på sex områden. En godkänd vecka ger bonus på månadens
          provision.
        </p>
      </div>

      {!policy && (
        <Notis ton="warn">
          Inga K&amp;V-regler gäller för {manadsnamn(manad)}. Ingenting räknas förrän de är satta.
        </Notis>
      )}

      {policy && fel && (
        <Notis ton="warn">
          {fel}{" "}
          {bedomare && (
            <Link href="/kv/regler" className="underline">
              Gå till inställningarna
            </Link>
          )}
        </Notis>
      )}

      {policy && (
        <MinVy
          user={user}
          samtal={samtal}
          policy={policy}
          kriterier={kriterier}
          manad={manad}
          minaOrder={minaOrder}
          nivaer={nivaer}
        />
      )}

      {chef && policy && (
        <Card>
          <CardHeader
            titel={`Rutnät, ${manadsnamn(manad)}`}
            beskrivning="En vecka utan bedömning räknas varken för eller emot — men den syns här. Klicka på ett samtal för att bedöma det."
          />
          <Rutnat samtal={samtal} personer={personer} policy={policy} manad={manad} />
        </Card>
      )}

      {bedomare && (
        <Card>
          <CardHeader
            titel="Registrera ett samtal"
            beskrivning="Urvalet sker utanför Nav tills dialern är inkopplad. Registrera samtalet här, bedöm det sedan."
          />
          <Registrera personer={personer} />
        </Card>
      )}
    </div>
  );
}

/**
 * Saljarens egen vy: veckorna, bonusen och utvecklingskurvan.
 *
 * BONUSEN RAKNAS PA GRUNDPROVISION PLUS VOLYMBONUS (O3), sa vyn maste hamta
 * ordern ocksa. Att visa procenten utan kronbeloppet hade varit halva svaret —
 * 1,25 % sager ingenting utan att veta av vad.
 */
async function MinVy({
  user,
  samtal,
  policy,
  kriterier,
  manad,
  minaOrder,
  nivaer,
}: {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  samtal: Samtalsrad[];
  policy: KvPolicy;
  kriterier: KvKriterium[];
  manad: string;
  minaOrder: Awaited<ReturnType<typeof hamtaOrderFor>>;
  nivaer: Awaited<ReturnType<typeof hamtaNivaer>>;
}) {
  const mina = samtal.filter((s) => s.employee_id === user.employee!.id);
  const m = kvManad(mina, manad, policy);

  const underlag = raknaUnderlag(user.employee!.id, minaOrder, manad, nivaer, {
    godkanda: m.godkanda,
    bedomda: m.bedomda,
    procent: m.procent,
  });

  const kurva = kurvaPerOmrade(
    mina.flatMap((s) => s.omraden.map((o) => ({ call_date: s.call_date, ...o }))),
  );

  return (
    <>
      <Card status="brand">
        <CardHeader
          titel={`Din K&V i ${manadsnamn(manad)}`}
          beskrivning={`Tröskel ${policy.threshold_points} poäng per vecka, räknat på summan av veckans ${policy.calls_per_week} samtal.`}
        />
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
          <div>
            <p className="tnum text-display text-ink-900">{kronor(underlag.kv?.belopp ?? 0)}</p>
            <p className="text-small text-ink-500">
              {m.godkanda} godkänd{m.godkanda === 1 ? "" : "a"} {m.godkanda === 1 ? "vecka" : "veckor"}
              {m.procent > 0 && ` · ${m.procent} %`}
            </p>
          </div>
          <div>
            <p className="tnum text-h1 text-ink-900">
              {kronor(underlag.grundprovision + (underlag.volymbonus?.belopp ?? 0))}
            </p>
            <p className="text-small text-ink-500">basen bonusen räknas på</p>
          </div>
          <div>
            <p className="tnum text-h1 text-ink-900">{policy.cap_percent} %</p>
            <p className="text-small text-ink-500">tak per månad</p>
          </div>
        </div>

        {m.veckor.length === 0 ? (
          <p className="mt-4 text-small text-ink-500">
            Inga samtal är registrerade den här månaden.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {m.veckor.map((v) => (
              <li
                key={v.start}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-24 text-body text-ink-900">Vecka {v.nummer}</span>
                {v.fullstandig ? (
                  <Badge ton={v.godkand ? "ok" : "warn"}>{v.godkand ? "Godkänd" : "Under tröskeln"}</Badge>
                ) : (
                  <Badge ton="neutral">Ej bedömd</Badge>
                )}
                <span className="tnum flex-1 text-small text-ink-500">
                  {v.fullstandig
                    ? `${v.poang} av ${policy.threshold_points} poäng`
                    : `${v.bedomda} av ${policy.calls_per_week} samtal bedömda`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* AVSNITT 6.2: skalet till att en vecka hoppas over far ALDRIG synas.
            "Ej bedomd — sjukfranvaro" i en prestationsvy ar sjukdata i en
            provisionsvy, vilket AC-3.26 och E7.14 forbjuder. */}
        <p className="mt-4 text-small text-ink-500">
          En vecka utan fullständig bedömning hoppas över och räknas varken för eller emot.
        </p>
      </Card>

      {kurva.size > 0 && (
        <Card>
          <CardHeader
            titel="Din utveckling per område"
            beskrivning="Snittpoäng per månad, äldst först. Snitt och inte summa — en månad med fler samtal ska inte se bättre ut."
          />
          <Kurva kurva={kurva} kriterier={kriterier} />
        </Card>
      )}
    </>
  );
}

/** Utvecklingskurvan som en enkel stapelrad per omrade. */
function Kurva({
  kurva,
  kriterier,
}: {
  kurva: ReturnType<typeof kurvaPerOmrade>;
  kriterier: KvKriterium[];
}) {
  return (
    <ul className="flex flex-col gap-4">
      {kriterier
        .filter((k) => kurva.has(k.id))
        .map((k) => {
          const punkter = kurva.get(k.id)!;
          const tak = k.max_points ?? Math.max(...punkter.map((p) => p.snitt), 1);

          return (
            <li key={k.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-body text-ink-900">{k.label}</span>
                <span className="tnum text-small text-ink-500">
                  {Math.round(punkter[punkter.length - 1].snitt * 10) / 10}
                  {k.max_points !== null && ` av ${k.max_points}`}
                </span>
              </div>
              <div className="flex items-end gap-2">
                {punkter.map((p) => (
                  <div key={p.manad} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-sm bg-brand-500"
                      style={{ height: `${Math.max(4, (p.snitt / tak) * 48)}px` }}
                      title={`${manadsnamn(p.manad)}: ${Math.round(p.snitt * 10) / 10} (${p.antal} samtal)`}
                    />
                    <span className="text-micro text-ink-500">{p.manad.slice(5, 7)}</span>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * Chefens rutnat: saljare x vecka.
 *
 * DE TOMMA RUTORNA AR POANGEN. En vecka utan bedomning raknas varken for eller
 * emot, sa ingen siffra nagonstans avslojar att den saknas — utom har.
 */
function Rutnat({
  samtal,
  personer,
  policy,
  manad,
}: {
  samtal: Samtalsrad[];
  personer: { id: string; namn: string }[];
  policy: KvPolicy;
  manad: string;
}) {
  // Veckorna som finns i manaden, ur samtliga samtal. Har ingen ett samtal en
  // vecka finns kolumnen inte — och det ar ratt: rutnatet visar de veckor som
  // faktiskt har nagot i sig.
  const veckor = [
    ...new Set(
      personer.flatMap((p) =>
        veckorFor(
          samtal.filter((s) => s.employee_id === p.id),
          manad,
          policy,
        ).map((v) => v.start),
      ),
    ),
  ].sort();

  if (veckor.length === 0) {
    return (
      <EmptyState
        rubrik="Inga samtal den här månaden"
        text="Registrera det första samtalet i formuläret nedan."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-small">
        <thead>
          <tr>
            <th className="py-2 text-left text-micro font-normal text-ink-500">Säljare</th>
            {veckor.map((v) => (
              <th key={v} className="py-2 text-center text-micro font-normal text-ink-500">
                v{veckorFor(samtal, manad, policy).find((x) => x.start === v)?.nummer ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {personer.map((p) => {
            const mina = samtal.filter((s) => s.employee_id === p.id);
            const vs = veckorFor(mina, manad, policy);

            return (
              <tr key={p.id} className="border-t border-canvas">
                <td className="py-2 pr-4 text-body text-ink-900">{p.namn}</td>
                {veckor.map((start) => {
                  const v = vs.find((x) => x.start === start);
                  return (
                    <td key={start} className="py-2 text-center">
                      <Ruta vecka={v} samtal={mina} start={start} policy={policy} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Ruta({
  vecka,
  samtal,
  start,
  policy,
}: {
  vecka: ReturnType<typeof veckorFor>[number] | undefined;
  samtal: Samtalsrad[];
  start: string;
  policy: KvPolicy;
}) {
  if (!vecka) return <span className="text-ink-500">·</span>;

  const forsta = vecka.samtal[0];
  const etikett = vecka.fullstandig ? String(vecka.poang) : `${vecka.bedomda}/${policy.calls_per_week}`;

  return (
    <Link
      href={`/kv/${forsta.id}`}
      className={`tnum inline-flex min-h-9 min-w-11 items-center justify-center rounded-sm px-2 ${
        vecka.godkand
          ? "bg-ok/15 text-ink-900"
          : vecka.fullstandig
            ? "bg-warn/15 text-ink-900"
            : "bg-surface-alt text-ink-500"
      }`}
      title={`${samtal.filter((s) => s.call_date >= start).length} samtal`}
    >
      {etikett}
    </Link>
  );
}

/** Aktiva saljare, for rutnatet och registreringen. RLS avgor vilka som syns. */
async function hamtaSaljare(): Promise<{ id: string; namn: string }[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("employee")
    .select("id, first_name, last_name")
    .in("status", ["active", "onboarding"])
    .order("first_name");

  return (data ?? []).map((e) => ({ id: e.id, namn: fullName(e) }));
}
