"use client";

import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { Filuppladdning } from "@/components/Filuppladdning";
import { storlek } from "@/lib/filer";
import { LAGE_ETIKETT, LAGE_TON, lageFor } from "@/lib/rollspel";
import { forberedRollspel, registreraRollspel } from "../../../actions";

export type Inlamning = {
  id: string;
  fileId: string;
  byte: number;
  inlamnad: string;
  bedomd: string | null;
  godkant: boolean | null;
  poang: number | null;
  aterkoppling: string | null;
};

/**
 * E8.7 / AC-6.7: säljarens vy av ett rollspel.
 *
 * RUBRIKEN STÅR FÖRE UPPLADDNINGEN, och det är inte en layoutdetalj. Den som
 * ska bedömas ska veta vad hon bedöms på innan hon spelar in — en bedömning
 * mot kriterier man får se först i efterhand är inte en bedömning utan ett
 * omdöme. Samma ordning som telefonlistan före registreringen på sjuksidan.
 */
export function Rollspel({
  modulId,
  kriterier,
  inlamningar,
}: {
  modulId: string;
  kriterier: { id: string; label: string; guidance: string | null; max_points: number }[];
  inlamningar: Inlamning[];
}) {
  const lage = lageFor(
    inlamningar.map((i) => ({
      submitted_at: i.inlamnad,
      graded_at: i.bedomd,
      passed: i.godkant,
    })),
  );

  const senaste = [...inlamningar].sort((a, b) => (a.inlamnad < b.inlamnad ? 1 : -1))[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h2 text-ink-900">Rollspel</h2>
        <Badge ton={LAGE_TON[lage]}>{LAGE_ETIKETT[lage]}</Badge>
      </div>

      <div>
        <h3 className="text-small font-semibold text-ink-700">Du bedöms på det här</h3>
        {kriterier.length === 0 ? (
          <Notis ton="warn">
            Ingen rubrik är skriven än. Vänta med att spela in tills den som äger kursen lagt in
            vad du bedöms på.
          </Notis>
        ) : (
          <ul className="mt-2 flex flex-col">
            {kriterier.map((k) => (
              <li key={k.id} className="border-b border-canvas py-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body text-ink-900">{k.label}</span>
                  <span className="tnum shrink-0 text-micro text-ink-500">
                    {k.max_points} p
                  </span>
                </div>
                {k.guidance && <p className="mt-0.5 text-small text-ink-500">{k.guidance}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {senaste?.bedomd && (
        <div className="rounded-sm bg-surface-alt p-4">
          <p className="text-small font-semibold text-ink-700">
            {senaste.godkant ? "Godkänt" : "Underkänt"} — {senaste.poang} %
          </p>
          {senaste.aterkoppling && (
            <p className="mt-2 max-w-[70ch] whitespace-pre-wrap text-body text-ink-700">
              {senaste.aterkoppling}
            </p>
          )}
          {!senaste.godkant && (
            <p className="mt-2 text-small text-ink-500">
              Spela in ett nytt samtal och lämna in igen. Det gamla ligger kvar — både godkänt och
              underkänt är historik som inte skrivs över.
            </p>
          )}
        </div>
      )}

      {lage === "vantar" && (
        <Notis ton="info">
          Inlämnat {senaste.inlamnad.slice(0, 10)}. Din chef bedömer inspelningen mot rubriken
          ovan.
        </Notis>
      )}

      {inlamningar.length > 0 && (
        <div>
          <h3 className="text-small font-semibold text-ink-700">Dina inlämningar</h3>
          <ul className="mt-2 flex flex-col">
            {inlamningar.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-baseline gap-x-3 border-b border-canvas py-2 last:border-0"
              >
                <a
                  href={`/filer/${i.fileId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-small text-brand-700 underline underline-offset-2 hover:text-brand-900"
                >
                  {i.inlamnad.slice(0, 10)}
                </a>
                <span className="tnum text-micro text-ink-500">{storlek(i.byte)}</span>
                <span className="text-micro text-ink-500">
                  {i.bedomd ? `${i.poang} % · ${i.godkant ? "godkänt" : "underkänt"}` : "väntar"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lage !== "godkant" && kriterier.length > 0 && (
        <Filuppladdning
          andamal="roleplay"
          etikett={inlamningar.length === 0 ? "Ladda upp testsamtalet" : "Lämna in ett nytt försök"}
          knapp="Lämna in"
          hjalp="Ljudfil: MP3, M4A, WAV eller WEBM. Bara du, din chef och ledningen kan lyssna, och varje öppning loggas."
          forbered={(namn, mime, byte) => forberedRollspel(modulId, namn, mime, byte)}
          registrera={(fileId, namn) => registreraRollspel(modulId, fileId, namn)}
        />
      )}
    </div>
  );
}
