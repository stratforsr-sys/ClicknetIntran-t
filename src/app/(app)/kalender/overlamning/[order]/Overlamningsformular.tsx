"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sparaOverlamning } from "../../moten/actions";

type Falt = { mal: string; lovat: string; bastaTid: string; risker: string };

const RADER: [keyof Falt, string, string][] = [
  ["mal", "Kundens mål", "Vad vill kunden uppnå? Till exempel: fler tårtbeställningar via Google inför helger."],
  ["lovat", "Vad som lovades i säljsamtalet", "Det leveransen ska hålla. Till exempel: profilen uppdaterad inom två veckor."],
  ["bastaTid", "Bästa tid att ringa", "Till exempel: efter 14"],
  ["risker", "Risker", "Det leveransen behöver veta innan de ringer."],
];

export function Overlamningsformular({ orderId, start }: { orderId: string; start: Falt }) {
  const [falt, setFalt] = useState<Falt>(start);
  const [besked, setBesked] = useState<string | null>(null);
  const [vantar, startOvergang] = useTransition();
  const router = useRouter();

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={(ev) => {
        ev.preventDefault();
        startOvergang(async () => {
          const r = await sparaOverlamning(orderId, falt);
          setBesked(r.fel ?? r.kvitto ?? null);
          if (!r.fel) router.refresh();
        });
      }}
    >
      {RADER.map(([k, rubrik, exempel]) => (
        <label key={k} className="field" htmlFor={`ov-${k}`}>
          {rubrik}
          {k === "bastaTid" ? (
            <input id={`ov-${k}`} type="text" maxLength={120} placeholder={exempel} value={falt[k]} onChange={(e) => setFalt((f) => ({ ...f, [k]: e.target.value }))} />
          ) : (
            <textarea id={`ov-${k}`} maxLength={600} placeholder={exempel} value={falt[k]} onChange={(e) => setFalt((f) => ({ ...f, [k]: e.target.value }))} />
          )}
        </label>
      ))}
      <div className="acts">
        <button className="btn primary" type="submit" disabled={vantar}>
          Spara överlämningen
        </button>
      </div>
      {besked && (
        <p className="hint" role="status">
          {besked}
        </p>
      )}
    </form>
  );
}
