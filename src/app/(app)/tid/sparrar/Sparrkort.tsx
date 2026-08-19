"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Field, Select } from "@/components/ui/Field";
import { kopplaDokument, slaPa, slaAv, type SparrState } from "./actions";

type Dokument = { id: string; title: string; status: string; decided_on: string | null };

export type Sparrvy = {
  key: string;
  title: string;
  enabled: boolean;
  enabled_at: string | null;
  note: string | null;
  interest_assessment_id: string | null;
  staff_information_id: string | null;
  saknas: string[];
};

function Koppling({
  sparr,
  falt,
  etikett,
  hjalp,
  dokument,
}: {
  sparr: Sparrvy;
  falt: "interest_assessment_id" | "staff_information_id";
  etikett: string;
  hjalp: string;
  dokument: Dokument[];
}) {
  const [state, action] = useActionState<SparrState, FormData>(kopplaDokument, {});
  const valt = sparr[falt] ?? "";

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="key" value={sparr.key} />
      <input type="hidden" name="falt" value={falt} />
      <Field label={etikett} namn={`${sparr.key}-${falt}`} hjalp={hjalp}>
        <Select namn="dokument_id" defaultValue={valt} className="min-w-[20rem]">
          <option value="">Inget dokument valt</option>
          {dokument.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
              {d.status !== "published" ? " (utkast)" : ""}
              {d.decided_on ? ` · beslutad ${d.decided_on}` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="sekundar" size="sm">
        Koppla
      </Button>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
    </form>
  );
}

/**
 * Ett kort per spärr. Vad som är påslaget, på vilken grund, och exakt vad som
 * saknas för att kunna slå på — hämtat ur samma funktion som databasens trigger
 * dömer efter, så att listan aldrig säger något annat än knappen.
 */
export function Sparrkort({
  sparr,
  avvagningar,
  informationer,
}: {
  sparr: Sparrvy;
  avvagningar: Dokument[];
  informationer: Dokument[];
}) {
  const [paState, paAction, paVantar] = useActionState<SparrState, FormData>(slaPa, {});
  const [avState, avAction, avVantar] = useActionState<SparrState, FormData>(slaAv, {});
  const kanSlaPa = sparr.saknas.length === 0;

  return (
    <Card status={sparr.enabled ? "ok" : "warn"}>
      <CardHeader
        titel={sparr.title}
        beskrivning={sparr.note ?? undefined}
        handling={<Badge ton={sparr.enabled ? "ok" : "neutral"}>{sparr.enabled ? "Påslagen" : "Avstängd"}</Badge>}
      />

      {sparr.enabled && sparr.enabled_at && (
        <p className="text-small text-ink-500">
          Påslagen {new Date(sparr.enabled_at).toLocaleDateString("sv-SE")}.
        </p>
      )}

      {sparr.key === "raststampling" && (
        <div className="mt-4 flex flex-col gap-4">
          <Koppling
            sparr={sparr}
            falt="interest_assessment_id"
            etikett="K12 — intresseavvägning"
            hjalp="Måste vara publicerad och ha ett beslutsdatum."
            dokument={avvagningar}
          />
          <Koppling
            sparr={sparr}
            falt="staff_information_id"
            etikett="K14 — information till personalen"
            hjalp="Måste vara publicerad och kvitterad av varje aktiv anställd."
            dokument={informationer}
          />
        </div>
      )}

      {!sparr.enabled && sparr.saknas.length > 0 && (
        <div className="mt-4">
          <p className="text-small font-semibold text-ink-700">Detta saknas:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {sparr.saknas.map((rad) => (
              <li key={rad} className="text-small text-ink-700">
                — {rad}
              </li>
            ))}
          </ul>
        </div>
      )}

      {paState.fel && (
        <div className="mt-4">
          <Notis ton="danger">{paState.fel}</Notis>
        </div>
      )}
      {(paState.ok || avState.ok) && (
        <div className="mt-4">
          <Notis ton="ok">{paState.ok ?? avState.ok}</Notis>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {sparr.enabled ? (
          <form action={avAction}>
            <input type="hidden" name="key" value={sparr.key} />
            <Button type="submit" variant="destruktiv" size="sm" laddar={avVantar}>
              Slå av
            </Button>
          </form>
        ) : (
          <form action={paAction}>
            <input type="hidden" name="key" value={sparr.key} />
            <Button type="submit" size="sm" laddar={paVantar} disabled={!kanSlaPa}>
              Slå på
            </Button>
          </form>
        )}

        {!sparr.enabled && !kanSlaPa && (
          <span className="text-small text-ink-500">
            Knappen öppnas när listan ovan är tom. Spärren sitter i databasen — den går inte förbi.
          </span>
        )}
      </div>
    </Card>
  );
}
