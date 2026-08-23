"use client";

import { useEffect, useState } from "react";
import {
  andel,
  fonster,
  klockslag,
  kvarTillSlut,
  minuter as minuterFranTid,
  rastnedrakning,
  segment,
} from "@/lib/dagslinje";
import { svenskaMinuter } from "@/lib/klocka";
import { timmarOchMinuter, type Handelse } from "@/lib/tid";

/**
 * Dagens tidslinje. Ritar vad som stamplats, inte vad som borde ha stamplats —
 * hela resonemanget star i `src/lib/dagslinje.ts`.
 *
 * Klockan far tickas i webblasaren av samma skal som i statusbandet: den som
 * later fliken sta oppen ska inte se en markor som frusit vid lunch. FORSTA
 * renderingen anvander serverns tid rakt av, sa att hydreringen stammer.
 */
export function Dagslinje({
  handelser,
  schema,
  rastLangd,
  serverTid,
}: {
  handelser: Handelse[];
  schema: { start_time: string; end_time: string } | null;
  /** Schemalagd rastlangd i minuter, eller null nar rasten inte ar pa. */
  rastLangd: number | null;
  serverTid: string;
}) {
  const [nu, setNu] = useState(() => new Date(serverTid));

  useEffect(() => {
    const id = setInterval(() => setNu(new Date()), 30_000);
    setNu(new Date());
    return () => clearInterval(id);
  }, []);

  const segmenten = segment(handelser, nu);
  const ram = fonster(segmenten, schema, nu);
  const nuAndel = andel(svenskaMinuter(nu), ram);
  const rast = rastnedrakning(handelser, rastLangd, nu);
  const kvar = kvarTillSlut(schema, nu);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-8">
        {/* Sparet. Schemats del av dygnet ar ljusare an resten, sa att det gar
            att se att man borjat fore eller slutat efter utan att nagot
            fargas som ett fel. */}
        <div className="absolute inset-x-0 top-2 h-4 rounded-full bg-canvas" />

        {schema && (
          <div
            className="absolute top-2 h-4 rounded-full bg-brand-50"
            style={{
              left: `${andel(minuterFranTid(schema.start_time), ram)}%`,
              width: `${
                andel(minuterFranTid(schema.end_time), ram) -
                andel(minuterFranTid(schema.start_time), ram)
              }%`,
            }}
          />
        )}

        {segmenten.map((s, i) => (
          <div
            key={`${s.fran}-${i}`}
            title={`${s.typ === "rast" ? "Rast" : "Arbete"} ${klockslag(s.fran)}–${
              s.oppen ? "nu" : klockslag(s.till)
            }`}
            className={`absolute top-2 h-4 rounded-full ${
              s.typ === "rast" ? "bg-brand-200" : "bg-brand-500"
            }`}
            style={{
              left: `${andel(s.fran, ram)}%`,
              width: `${Math.max(0.8, andel(s.till, ram) - andel(s.fran, ram))}%`,
            }}
          />
        ))}

        {/* Nu-markoren. Ink och inte statusfarg: den sager vilken tid det ar,
            inte om nagot ar bra eller daligt. */}
        <div
          className="absolute top-0 h-8 w-0.5 -translate-x-1/2 rounded-full bg-ink-900"
          style={{ left: `${nuAndel}%` }}
        />
      </div>

      <div className="flex justify-between text-micro text-ink-500">
        <span className="tnum">{klockslag(ram.fran)}</span>
        {schema && (
          <span>
            Schema {schema.start_time.slice(0, 5)}–{schema.end_time.slice(0, 5)}
          </span>
        )}
        <span className="tnum">{klockslag(ram.till)}</span>
      </div>

      {rast && (
        <p className="text-small text-ink-700">
          {rast.over ? (
            <>
              Rasten har pågått <span className="tnum">{timmarOchMinuter(rast.gatt)}</span> av{" "}
              <span className="tnum">{rast.langd} min</span>.
            </>
          ) : (
            <>
              <span className="tnum">{rast.kvar} min</span> kvar av rasten.
            </>
          )}
        </p>
      )}

      {kvar !== null && kvar > 0 && !rast && (
        <p className="text-small text-ink-500">
          <span className="tnum">{timmarOchMinuter(kvar)}</span> kvar till schemats slut.
        </p>
      )}
    </div>
  );
}
