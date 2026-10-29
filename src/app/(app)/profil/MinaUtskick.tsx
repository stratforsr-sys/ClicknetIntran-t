"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notis } from "@/components/ui/Notis";
import type { Kanal, Personlager, Regler } from "@/lib/utskick";
import type { Utskicksvy } from "@/lib/utskick-server";
import { hamtaUtskick, sparaUtskickAction } from "./actions";
import { Brytare, Matare, Veck } from "./UtskickDelat";
import {
  avsnittNycklar, gar, med, nyckelVarde, omradenI, raknaOmrade, raknaOmraden,
  sortNycklar, sorterI, valjVarde, type Omrade,
} from "./utskick-klient";

/**
 * "Notiser och mejl": var och en väljer vad som når den själv, per kanal.
 *
 * Det egna lagret kan bara stänga det superadmin lämnat öppet. Det superadmin
 * stängt visas låst ("Avstängt av superadmin") och går inte att öppna här —
 * samma regel som servern håller i `far()`, så att knappen inte lovar något
 * som sedan inte händer.
 */

const TEXT: Record<Kanal, string> = {
  klocka: "Klockan uppe i navet.",
  mejl: "Händelser som kommer till din e-post.",
  push: "Notiser som dyker upp på telefonen.",
  morgon: "Vilka avsnitt som får vara med i morgonbrevet.",
};

export function MinaUtskick({ vy: start }: { vy: Utskicksvy }) {
  const [vy, setVy] = useState(start);
  const [egen, setEgen] = useState<Regler>(start.mina.egen ?? {});
  const [fel, setFel] = useState<string | null>(null);

  if (vy.fel) return <Notis ton="warn">{vy.fel}</Notis>;

  const lager = { ...vy.mina, egen };
  const last = (k: Kanal, nyckel: string) => !!vy.last[k]?.includes(nyckel);

  /** Optimistiskt: ritar först, sparar sedan, och backar just den nyckeln om servern säger nej. */
  async function satt(kanal: Kanal, nyckel: string, varde: boolean | null) {
    const fore = nyckelVarde(egen, kanal, nyckel);
    setEgen((e) => med(e, kanal, nyckel, varde));
    setFel(null);
    try {
      const svar = await sparaUtskickAction({ lager: "egen", kanal, nyckel, varde });
      if (!svar.ok) throw new Error(svar.fel);
    } catch (e) {
      setEgen((n) => med(n, kanal, nyckel, fore));
      setFel(e instanceof Error ? e.message : "Det gick inte att spara. Ingenting ändrades.");
      // Läs om från servern: är vi oense om läget ska servern få rätt.
      const ny = await hamtaUtskick().catch(() => null);
      if (ny && !ny.fel) {
        setVy(ny);
        setEgen(ny.mina.egen ?? {});
      }
    }
  }

  const medEgen = (kanal: Kanal, nyckel: string, v: boolean | null) => ({ ...lager, egen: med(egen, kanal, nyckel, v) });

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-small text-ink-500">
        Du väljer själv vad som når dig. Koder för inloggning kommer alltid, vad du än stänger här.
      </p>
      {fel && <Notis ton="danger">{fel}</Notis>}

      {vy.katalog.kanaler.map((k) => {
        const kanal = k.id;
        const heltLast = last(kanal, "*");
        const kanalPa = gar(lager, kanal, ["*"], true);
        const antal = kanal === "morgon" ? null : raknaOmraden(lager, kanal, vy.katalog);
        const morgonPa = vy.katalog.avsnitt.filter((a) => gar(lager, "morgon", avsnittNycklar(a.id), true)).length;

        return (
          <Card key={kanal}>
            <CardHeader
              titel={k.namn}
              beskrivning={TEXT[kanal]}
              handling={
                <div className="flex items-center gap-2">
                  {heltLast && <span className="text-small text-ink-500">Avstängt av superadmin</span>}
                  <Brytare
                    pa={kanalPa}
                    last={heltLast}
                    etikett={`${k.namn}, hela kanalen`}
                    // På igen = Ärv. Ett uttryckligt På på hela kanalen hade öppnat sorter som är av som standard.
                    onVal={(pa) => satt(kanal, "*", pa ? null : false)}
                  />
                </div>
              }
            />
            {antal ? (
              <Matare pa={antal.pa} av={antal.av} etikett={`${antal.pa} av ${antal.av} områden på`} />
            ) : (
              <Matare pa={morgonPa} av={vy.katalog.avsnitt.length} etikett={`${morgonPa} av ${vy.katalog.avsnitt.length} avsnitt på`} />
            )}

            <ul className="mt-3 divide-y divide-canvas">
              {kanal === "morgon"
                ? vy.katalog.avsnitt.map((a) => {
                    const n = avsnittNycklar(a.id);
                    const lastad = last("morgon", `avsnitt:${a.id}`);
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3">
                        <Namn namn={a.namn} lastad={lastad} />
                        <Brytare
                          pa={gar(lager, "morgon", n, true)}
                          last={lastad}
                          etikett={a.namn}
                          onVal={(pa) =>
                            satt("morgon", `avsnitt:${a.id}`, valjVarde(pa, () => gar(medEgen("morgon", `avsnitt:${a.id}`, null), "morgon", n, true)))
                          }
                        />
                      </li>
                    );
                  })
                : omradenI(vy.katalog, kanal).map((o) => (
                    <OmradeRad key={o.id} o={o} kanal={kanal} lager={lager} last={last} satt={satt} medEgen={medEgen} />
                  ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Namn({ namn, lastad, undertext }: { namn: string; lastad: boolean; undertext?: string }) {
  return (
    <span className="min-w-0 flex-1 py-2">
      <span className="block text-body text-ink-900">{namn}</span>
      {(lastad || undertext) && (
        <span className="block text-small text-ink-500">{lastad ? "Avstängt av superadmin" : undertext}</span>
      )}
    </span>
  );
}

function OmradeRad({
  o,
  kanal,
  lager,
  last,
  satt,
  medEgen,
}: {
  o: Omrade;
  kanal: Kanal;
  lager: Personlager;
  last: (k: Kanal, nyckel: string) => boolean;
  satt: (k: Kanal, nyckel: string, v: boolean | null) => void;
  medEgen: (k: Kanal, nyckel: string, v: boolean | null) => Personlager;
}) {
  const [oppen, setOppen] = useState(false);
  const r = raknaOmrade(lager, kanal, o);
  const nyckel = `omrade:${o.id}`;
  const lastad = last(kanal, nyckel);
  const sorter = sorterI(o, kanal);

  return (
    <li>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={oppen}
          onClick={() => setOppen(!oppen)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <Veck oppen={oppen} />
          <span className="min-w-0">
            <span className="block text-body text-ink-900">{o.namn}</span>
            <span className="tnum block text-small text-ink-500">
              {lastad ? "Avstängt av superadmin" : `${r.pa} av ${r.av} på`}
            </span>
          </span>
        </button>
        <Brytare
          pa={r.pa > 0}
          last={lastad}
          etikett={o.namn}
          // På igen = Ärv, och ett uttryckligt På bara när standarden annars lämnar allt av.
          onVal={(pa) =>
            satt(kanal, nyckel, valjVarde(pa, () => raknaOmrade(medEgen(kanal, nyckel, null), kanal, o).pa > 0))
          }
        />
      </div>
      {oppen && (
        <ul className="mb-2 ml-6 border-l border-canvas pl-3">
          {sorter.map((s) => {
            const n = sortNycklar(o.id, s.id);
            const sl = last(kanal, `sort:${s.id}`);
            const std = s.standard[kanal] ?? false;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <Namn namn={s.namn} lastad={sl} />
                <Brytare
                  pa={gar(lager, kanal, n, std)}
                  last={sl}
                  etikett={s.namn}
                  onVal={(pa) =>
                    satt(kanal, `sort:${s.id}`, valjVarde(pa, () => gar(medEgen(kanal, `sort:${s.id}`, null), kanal, n, std)))
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
