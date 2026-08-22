"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { VARIABLER, hittaPlatshallare } from "@/lib/avtal";
import { skapaAvtal, type AvtalState } from "../actions";

const TOM: AvtalState = {};

type Mall = {
  id: string;
  title: string;
  body_md: string;
  employment_type: string | null;
};

type Person = {
  id: string;
  namn: string;
  employment_type: string;
};

/**
 * E9.1. Skapa avtalet.
 *
 * Formularet visar BARA de falt den valda mallen faktiskt anvander. En mall
 * for konsulter som inte namner semesterdagar ska inte be nagon fylla i
 * semesterdagar — ett ifyllt falt som inte hamnar i texten far den som fyller
 * i det att tro att det star dar.
 *
 * Falten som hamtas ur registret visas inte alls. De gar inte att andra har,
 * och en ruta man inte far rora ar bara i vagen. Stammer de inte ar det
 * personalregistret som ska rattas, inte avtalet.
 */
export function Formular({ mallar, personer }: { mallar: Mall[]; personer: Person[] }) {
  const [state, skicka, vantar] = useActionState(skapaAvtal, TOM);
  const [mallId, setMallId] = useState(mallar[0]?.id ?? "");
  const [personId, setPersonId] = useState("");

  const vald = mallar.find((m) => m.id === mallId);
  const anvanda = vald ? hittaPlatshallare(vald.body_md) : [];
  const attFylla = VARIABLER.filter((v) => v.fran !== "employee" && anvanda.includes(v.nyckel));
  const franRegistret = VARIABLER.filter((v) => v.fran === "employee" && anvanda.includes(v.nyckel));

  return (
    <form action={skicka} className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Nytt avtal</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Välj person och mall. Avtalet skapas som utkast — det syns inte för
          personen förrän du utfärdar det.
        </p>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="flex flex-col gap-4">
          <Field label="Anställd" namn="employee_id">
            <Select
              namn="employee_id"
              required
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Välj person</option>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Mall" namn="mall_id">
            <Select
              namn="mall_id"
              required
              value={mallId}
              onChange={(e) => setMallId(e.target.value)}
            >
              {mallar.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </Field>

          {attFylla.length > 0 && (
            <div className="flex flex-col gap-4 border-t border-canvas pt-4">
              {attFylla.map((v) => (
                <Field key={v.nyckel} label={v.etikett} namn={`var_${v.nyckel}`} hjalp={v.hjalp}>
                  <Input namn={`var_${v.nyckel}`} required />
                </Field>
              ))}
            </div>
          )}

          <div>
            <Button type="submit" laddar={vantar} disabled={!personId || !mallId}>
              Skapa utkast
            </Button>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              titel="Hämtas ur registret"
              beskrivning="Stämmer något inte rättas det under Personal, inte här."
            />
            {franRegistret.length === 0 ? (
              <p className="text-small text-ink-500">Mallen använder inga sådana fält.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-small text-ink-700">
                {franRegistret.map((v) => (
                  <li key={v.nyckel}>{v.etikett}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader titel="Personnummer" />
            <p className="text-small text-ink-500">
              Navet lagrar inga personnummer. Det utskrivna avtalet har en rad
              där det fylls i för hand.
            </p>
          </Card>
        </div>
      </div>
    </form>
  );
}
