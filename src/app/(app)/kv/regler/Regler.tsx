"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import type { KvKriterium, KvPolicy } from "@/lib/kv";
import { sparaOmrade, sparaRegler, type KvReglerState } from "./actions";

/**
 * K&V-installningarna.
 *
 * ===========================================================================
 * RAKNAREN OVERST AR HELA POANGEN MED SIDAN.
 *
 * O4 var obesvarad i ett dygn, och orsaken var att "200 poang" kan betyda tre
 * saker: maxpoang 200, 400 eller 2 400. Samma troskel — 160 — blev da 80 %,
 * 40 % eller 6,7 %. Den sista gor troskeln meningslos: alla veckor godkanns.
 *
 * Raknaren visar procenten MEDAN man skriver, ur talen i formularet och inte ur
 * det sparade. Den som satter 200 pa varje omrade ser direkt att troskeln
 * blev 6,7 % — innan det ar sparat, och innan nagon far en bonus av misstag.
 * ===========================================================================
 */

const VERKAN = [
  { varde: "nasta_manad", etikett: "Från och med nästa månad" },
  { varde: "nu", etikett: "Från och med nu" },
  { varde: "denna_manad", etikett: "Allt intjänat denna månad (räknar om månaden)" },
];

export function Omraden({
  kriterier,
  policy,
}: {
  kriterier: KvKriterium[];
  policy: KvPolicy | null;
}) {
  const [state, action, vantar] = useActionState<KvReglerState, FormData>(sparaOmrade, {});

  // Utkastet: det som star i faltet just nu, inte det som ar sparat.
  const [utkast, setUtkast] = useState<Record<string, string>>(
    Object.fromEntries(kriterier.map((k) => [k.id, k.max_points === null ? "" : String(k.max_points)])),
  );

  const aktiva = kriterier.filter((k) => k.active);
  const varden = aktiva.map((k) => Number(String(utkast[k.id] ?? "").replace(",", ".")));
  const alltIfyllt = varden.every((v) => Number.isFinite(v) && v > 0);
  const perSamtal = alltIfyllt ? varden.reduce((s, v) => s + v, 0) : null;
  const perVecka = perSamtal !== null && policy ? perSamtal * policy.calls_per_week : null;
  const procent =
    perVecka !== null && perVecka > 0 && policy
      ? Math.round((policy.threshold_points / perVecka) * 1000) / 10
      : null;

  return (
    <div className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      {policy && (
        <Notis ton={procent === null ? "warn" : procent > 100 ? "danger" : procent < 25 ? "warn" : "info"}>
          {perSamtal === null ? (
            <>Fyll i maxpoäng för samtliga områden. Utan dem går inget samtal att bedöma.</>
          ) : (
            <>
              <strong>{perSamtal} poäng per samtal</strong>, {perVecka} poäng per vecka med{" "}
              {policy.calls_per_week} samtal.{" "}
              {procent !== null && procent > 100 ? (
                <>
                  Tröskeln {policy.threshold_points} poäng går <strong>inte att nå</strong>.
                </>
              ) : (
                <>
                  Tröskeln {policy.threshold_points} poäng motsvarar <strong>{procent} %</strong>
                  {procent !== null && procent < 25 && " — i praktiken godkänns då varje vecka"}.
                </>
              )}
            </>
          )}
        </Notis>
      )}

      <ul className="flex flex-col">
        {kriterier.map((k) => (
          <li key={k.id} className="border-b border-canvas py-3 last:border-0">
            <form action={action} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="criterion_id" value={k.id} />
              <span className="flex-1 text-body text-ink-900">{k.label}</span>
              <label className="flex items-center gap-2">
                <span className="text-micro text-ink-500">Maxpoäng</span>
                <input
                  name="max_points"
                  required
                  inputMode="decimal"
                  value={utkast[k.id] ?? ""}
                  onChange={(e) => setUtkast((f) => ({ ...f, [k.id]: e.target.value }))}
                  aria-label={`Maxpoäng för ${k.label}`}
                  className={`${KONTROLL} w-24`}
                />
              </label>
              <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
                Spara
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Reglerna({ policy }: { policy: KvPolicy | null }) {
  const [state, action, vantar] = useActionState<KvReglerState, FormData>(sparaRegler, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Falt
          namn="calls_per_week"
          etikett="Samtal per vecka"
          varde={policy?.calls_per_week}
          hjalp="Tröskeln räknas på summan av alla samtal i veckan."
        />
        <Falt
          namn="threshold_points"
          etikett="Tröskel, poäng"
          varde={policy?.threshold_points}
          hjalp="Summan som krävs för en godkänd vecka."
        />
        <Falt
          namn="percent_per_week"
          etikett="Procent per godkänd vecka"
          varde={policy?.percent_per_week}
          hjalp="Räknas på grundprovision plus volymbonus."
        />
        <Falt
          namn="cap_percent"
          etikett="Tak, procent per månad"
          varde={policy?.cap_percent}
          hjalp="Gäller även i en månad med fem veckor."
        />

        <label htmlFor="verkan" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Gäller från</span>
          <select id="verkan" name="verkan" required className={KONTROLL}>
            {VERKAN.map((v) => (
              <option key={v.varde} value={v.varde}>
                {v.etikett}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara reglerna
        </Button>
      </div>
    </form>
  );
}

function Falt({
  namn,
  etikett,
  varde,
  hjalp,
}: {
  namn: string;
  etikett: string;
  varde: number | undefined;
  hjalp: string;
}) {
  return (
    <label htmlFor={namn} className="flex flex-col gap-1">
      <span className="text-micro text-ink-500">{etikett}</span>
      <input
        id={namn}
        name={namn}
        required
        inputMode="decimal"
        defaultValue={varde ?? ""}
        className={KONTROLL}
      />
      <span className="text-micro text-ink-500">{hjalp}</span>
    </label>
  );
}
