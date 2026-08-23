"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { stampla, type TidState } from "./actions";
import { TYP_ETIKETT, type Lage, type Stamptyp } from "@/lib/tid";

const TOM: TidState = {};

const KNAPP: Record<Stamptyp, { text: string; variant: "primar" | "sekundar" }> = {
  in: { text: "Stämpla in", variant: "primar" },
  out: { text: "Stämpla ut", variant: "primar" },
  break_start: { text: "Börja rast", variant: "sekundar" },
  break_end: { text: "Avsluta rast", variant: "primar" },
};

/**
 * AC-2.1: ett tryck. Knappen skickar bara vad som hände — servern sätter
 * tiden och avgör om övergången är tillåten.
 *
 * AC-2.2: tappar nätet skrivs klockslaget ner i webbläsarens lagring och
 * skickas när sidan öppnas igen, med tiden det faktiskt hände.
 */
export function Stamplar({
  lage,
  tillatna,
  kompakt = false,
}: {
  lage: Lage;
  tillatna: Stamptyp[];
  /**
   * Startsidans snabbvalsrad. Knapparna star da bland andra knappar och
   * laget star redan i statusbandet ovanfor, sa den avslutande raden med
   * "Du ar instampad" hade sagt samma sak en gang till.
   *
   * Ko-formularet for stamplingar gjorda utan natverk ar kvar aven kompakt.
   * Det ar inte utsmyckning — utan det tappas stamplingen (AC-2.2).
   */
  kompakt?: boolean;
}) {
  const router = useRouter();
  const [state, skicka, vantar] = useActionState(stampla, TOM);
  const [koat, setKoat] = useState<{ typ: Stamptyp; tid: string } | null>(null);

  useEffect(() => {
    const sparat = localStorage.getItem("nav_stampling_ko");
    if (sparat) {
      try {
        setKoat(JSON.parse(sparat));
      } catch {
        localStorage.removeItem("nav_stampling_ko");
      }
    }
  }, []);

  useEffect(() => {
    if (state.ok) {
      localStorage.removeItem("nav_stampling_ko");
      setKoat(null);
      router.refresh();
    }
  }, [state.ok, router]);

  return (
    <div className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      {koat && (
        <form
          action={skicka}
          className="flex flex-col gap-3 rounded-sm bg-warn-tint p-4 text-warn-ink"
        >
          <input type="hidden" name="typ" value={koat.typ} />
          <input type="hidden" name="skedde_vid" value={koat.tid} />
          <p className="text-small">
            En stämpling gjordes utan nätverk: {TYP_ETIKETT[koat.typ].toLowerCase()} klockan{" "}
            {new Date(koat.tid).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}.
            Den tiden är den som sparas.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" laddar={vantar}>
              Skicka in den
            </Button>
            <Button
              type="button"
              variant="diskret"
              size="sm"
              onClick={() => {
                localStorage.removeItem("nav_stampling_ko");
                setKoat(null);
              }}
            >
              Släng den
            </Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-3">
        {tillatna.map((typ) => (
          <form
            key={typ}
            action={skicka}
            onSubmit={() => {
              // Sparas fore anropet. Gar det igenom raderas den direkt; gar
              // det inte igenom finns tiden kvar till nasta gang sidan oppnas.
              localStorage.setItem(
                "nav_stampling_ko",
                JSON.stringify({ typ, tid: new Date().toISOString() }),
              );
            }}
          >
            <input type="hidden" name="typ" value={typ} />
            <Button type="submit" variant={KNAPP[typ].variant} laddar={vantar} className="min-w-40">
              {KNAPP[typ].text}
            </Button>
          </form>
        ))}
      </div>

      {!kompakt && (
        <p className="text-small text-ink-500">
          {lage === "ute"
            ? "Du är inte instämplad."
            : lage === "rast"
              ? "Du är på rast."
              : "Du är instämplad."}
        </p>
      )}
    </div>
  );
}
