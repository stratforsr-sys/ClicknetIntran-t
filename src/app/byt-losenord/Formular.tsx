"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { MIN_TECKEN, bitar, styrka } from "@/lib/losenordskrav";
import { bytLosenord, type BytState } from "./actions";

const TOM: BytState = {};

const TON: Record<string, { bredd: string; farg: string; ord: string }> = {
  svagt: { bredd: "w-1/3", farg: "bg-danger", ord: "Svagt" },
  godkant: { bredd: "w-2/3", farg: "bg-warn", ord: "Godkänt" },
  starkt: { bredd: "w-full", farg: "bg-ok", ord: "Starkt" },
};

/**
 * Maglinjen rakna­s i webblasaren och avgor ingenting. Den finns for att en
 * manniska ska se skillnad pa tre ord och ett ord med en trea i — servern
 * dommer om samma losenord en gang till, och det ar den domen som galler.
 *
 * Kravet ar atta tecken och en siffra, sa ett fullt godkant losenord kan visa
 * "Svagt" har. Det ar meningen: raden ar ett rad och inte ett besked om att
 * formularet kommer neka ordet. Hjalptexten over faltet sager det rent ut.
 */
function Styrkemat({ losenord }: { losenord: string }) {
  if (losenord.length === 0) return null;
  const t = TON[styrka(losenord)];

  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-alt">
        <div className={`h-full rounded-full transition-all duration-fast ${t.bredd} ${t.farg}`} />
      </div>
      <span className="w-24 text-right text-small text-ink-500">
        {t.ord} · {bitar(losenord)} bitar
      </span>
    </div>
  );
}

export function Formular({ tvingat }: { tvingat: boolean }) {
  const [state, action, vantar] = useActionState(bytLosenord, TOM);
  const [nytt, setNytt] = useState("");
  const [upprepat, setUpprepat] = useState("");

  const olika = upprepat.length > 0 && nytt !== upprepat;

  return (
    <form action={action} className="flex flex-col gap-5">
      {state.fel && state.fel.length > 0 && (
        <Notis ton="danger">
          {state.fel.length === 1 ? (
            state.fel[0]
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {state.fel.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </Notis>
      )}

      <Field
        label={tvingat ? "Lösenordet du fick" : "Nuvarande lösenord"}
        namn="gammalt"
        hjalp={tvingat ? "Samma ord som du precis loggade in med." : undefined}
      >
        <Input namn="gammalt" type="password" autoComplete="current-password" required />
      </Field>

      <div className="flex flex-col gap-2">
        <Field
          label="Nytt lösenord"
          namn="nytt"
          hjalp={`Minst ${MIN_TECKEN} tecken och minst en siffra. I övrigt väljer du fritt — måttet nedanför är ett råd, inget krav.`}
        >
          <Input
            namn="nytt"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_TECKEN}
            value={nytt}
            onChange={(e) => setNytt(e.target.value)}
          />
        </Field>
        <Styrkemat losenord={nytt} />
      </div>

      <Field
        label="Nytt lösenord igen"
        namn="upprepat"
        fel={olika ? "De två stämmer inte överens." : undefined}
      >
        <Input
          namn="upprepat"
          type="password"
          autoComplete="new-password"
          required
          value={upprepat}
          onChange={(e) => setUpprepat(e.target.value)}
          fel={olika ? "x" : undefined}
        />
      </Field>

      <Button type="submit" laddar={vantar} disabled={olika}>
        Byt lösenord
      </Button>
    </form>
  );
}
