"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { hamtaLandningssida } from "./actions";

/**
 * Överst i kundkortets flik "Aktivitet" (Inkio, varv 4): är kundens
 * landningssida uppe?
 *
 * =============================================================================
 * "AKTIV" BETYDER ATT SIDAN SVARAR — NU
 *
 * Beställaren 2026-10-08 valde att Nav anropar sidan, inte att avtalet i Inkio
 * är aktivt. Adressen är kundens "Webbplats" i Inkio; saknas den säger rutan
 * det och länkar dit den fylls i. Inkio och sidan läses när fliken öppnas,
 * parallellt med aktiviteten — den ena väntar aldrig på den andra.
 * =============================================================================
 */

type Svar = Awaited<ReturnType<typeof hamtaLandningssida>>;

export function Landningssida({ orderId }: { orderId: string }) {
  const [svar, setSvar] = useState<Svar | null>(null);
  const [laddar, setLaddar] = useState(false);
  // Ökas av "Kolla igen" — effekten läser om när den ändras.
  const [varv, setVarv] = useState(0);

  // Samma mönster som Inkioaktivitet: ett svar för en kund man redan lämnat kastas.
  useEffect(() => {
    let aktuell = true;
    hamtaLandningssida(orderId).then((d) => {
      if (!aktuell) return;
      setSvar(d);
      setLaddar(false);
    });
    return () => {
      aktuell = false;
    };
  }, [orderId, varv]);

  const kollaIgen = () => {
    setLaddar(true);
    setVarv((v) => v + 1);
  };

  const v = vy(svar);
  // Inkio okopplat, eller kunden saknas där: aktiviteten under säger redan det.
  if (v.sort === "dolj") return null;

  return (
    <section
      aria-label="Landningssida"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-alt px-4 py-3"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {v.sort === "laddar" && <p className="text-small text-ink-500">Kollar landningssidan …</p>}
        {v.sort === "fel" && (
          <>
            <div>
              <Badge ton="neutral">Landningssida okänd</Badge>
            </div>
            <p className="text-small text-ink-500">{v.text}</p>
          </>
        )}
        {v.sort === "saknas" && (
          <>
            <div>
              <Badge ton="neutral">Landningssida saknas</Badge>
            </div>
            <p className="text-small text-ink-500">
              Kunden har ingen webbplats i Inkio.{" "}
              <a href={v.lank} target="_blank" rel="noreferrer" className="text-brand-ink underline-offset-2 hover:underline">
                Fyll i Webbplats på {v.nummer} ↗
              </a>
            </p>
          </>
        )}
        {v.sort === "klar" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge ton={v.aktiv ? "ok" : "danger"}>{v.aktiv ? "Landningssida aktiv" : "Landningssida inte aktiv"}</Badge>
              <span className="truncate text-small text-ink-700">{visningsadress(v.adress)}</span>
            </div>
            <p className="text-small text-ink-500">{v.text}</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {v.sort === "klar" && (
          <ButtonLink href={v.adress} extern size="sm" variant="sekundar">
            Gå till landningssida ↗
          </ButtonLink>
        )}
        {v.sort !== "laddar" && (
          <Button type="button" size="sm" variant="diskret" laddar={laddar} onClick={kollaIgen}>
            Kolla igen
          </Button>
        )}
      </div>
    </section>
  );
}

type Vy =
  | { sort: "laddar" }
  | { sort: "dolj" }
  | { sort: "fel"; text: string }
  | { sort: "saknas"; nummer: string; lank: string }
  | { sort: "klar"; adress: string; aktiv: boolean; text: string };

/** Svaret som det ska visas — ett steg i taget, så att typerna följer med. */
function vy(svar: Svar | null): Vy {
  if (!svar) return { sort: "laddar" };
  if ("fel" in svar) return { sort: "fel", text: svar.fel };
  if ("ejKopplat" in svar) return { sort: "dolj" };
  if (svar.kund === null) return { sort: "dolj" };
  if (svar.adress === null) return { sort: "saknas", nummer: svar.kund.nummer, lank: svar.kund.lank };
  return {
    sort: "klar",
    adress: svar.adress,
    aktiv: svar.lage?.aktiv ?? false,
    text: svar.lage?.text ?? "Sidan har inte kontrollerats.",
  };
}

/** Adressen som den läses: utan https:// och utan avslutande snedstreck. */
function visningsadress(adress: string): string {
  return adress.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
