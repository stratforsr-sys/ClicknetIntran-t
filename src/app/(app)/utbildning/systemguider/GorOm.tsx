"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { borjaOmGuide } from "@/components/guide/actions";

/**
 * Nollställer en guide så att turen börjar om.
 *
 * ===========================================================================
 * VARFÖR `router.refresh()` OCH INTE BARA `revalidatePath`
 *
 * Overlayen bor i (app)-layouten, inte i den här sidan — den måste kunna peka
 * på menyn och toppraden, och de ritas där. En revalidering av
 * `/utbildning/systemguider` gäller sidan; layouten ovanför kan ligga kvar.
 * Resultatet hade varit en knapp som säger "Börja om", en rad som ändrar sig
 * till "Ej påbörjad" — och ingen guide som startar förrän man laddade om för
 * hand.
 *
 * `refresh()` hämtar hela trädet på nytt, layouten inräknad, och då står turen
 * där direkt. Servern gör sitt jobb ändå; det här är bara det som får det att
 * synas.
 * ===========================================================================
 */
export function GorOm({ slug, klar }: { slug: string; klar: boolean }) {
  const [pagar, startOvergang] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant={klar ? "sekundar" : "diskret"}
      laddar={pagar}
      onClick={() =>
        startOvergang(async () => {
          await borjaOmGuide(slug);
          router.refresh();
        })
      }
    >
      {klar ? "Gör om" : "Börja om"}
    </Button>
  );
}
