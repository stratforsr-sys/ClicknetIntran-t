import { Badge } from "@/components/ui/Badge";
import { GUIDE_ETIKETT, GUIDE_TON, guideLage, type Progress } from "@/lib/guider";
import type { Guide } from "@/guider";

/**
 * Personens systemguider, som de ser ut för någon annan.
 *
 * ===========================================================================
 * RADERNA GÅR INTE ATT BOCKA AV, OCH DET ÄR HELA POÄNGEN.
 *
 * Beslutet 2026-08-31: guidestatusen ska synas bland dator och passerkort i
 * anställningschecklistan — men som en SPEGLING av guidens eget läge, inte som
 * egna kryssrutor. Utan funktionsspärrar är guidens bokföring det enda som
 * säger att någon faktiskt gått igenom den, och en chef som kan kryssa bort
 * raden har tagit bort det sista beviset.
 *
 * Därför finns här inga formulär och inga knappar. Vill man att någon ska bli
 * klar får man be henne göra turen.
 * ===========================================================================
 *
 * Ligger i en EGEN ruta bredvid checklistan i stället för inuti den, av ett
 * praktiskt skäl: checklistan ritas bara när det finns `onboarding_task`-rader,
 * och guidestatusen gäller även den som anställdes innan den listan fanns.
 */
export function Guidespegel({
  guider,
  rader,
}: {
  /** Guiderna som gäller just den här personen. Se `guiderForRoller()`. */
  guider: Guide[];
  rader: Progress[];
}) {
  const forSlug = new Map(rader.map((r) => [r.guide_slug, r]));
  const klara = guider.filter((g) => guideLage(g, forSlug.get(g.slug)) === "klar").length;

  if (guider.length === 0) {
    return <p className="text-small text-ink-500">Inga guider är riktade till den här rollen.</p>;
  }

  return (
    <>
      <ul className="flex flex-col">
        {guider.map((guide) => {
          const rad = forSlug.get(guide.slug) ?? null;
          const lage = guideLage(guide, rad);
          return (
            <li
              key={guide.slug}
              className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
            >
              <span className="flex-1 text-body text-ink-700">{guide.titel}</span>
              {lage === "pagar" && rad && (
                <span className="tnum text-small text-ink-500">
                  steg {rad.steg} av {guide.steg.length}
                </span>
              )}
              <Badge ton={GUIDE_TON[lage]}>{GUIDE_ETIKETT[lage]}</Badge>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-small text-ink-500">
        {klara === guider.length
          ? "Alla guider genomgångna. Statusen sattes av systemet."
          : `${klara} av ${guider.length} klara. Raderna följer guiden och går inte att kvittera för hand.`}
      </p>
    </>
  );
}
