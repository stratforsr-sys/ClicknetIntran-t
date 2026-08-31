"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { knuffa } from "@/components/guide/actions";

/**
 * Knappen som säger till.
 *
 * ===========================================================================
 * DEN BYTER TILL "SAGT TILL" OCH GÅR INTE ATT TRYCKA IGEN.
 *
 * Inte för att en andra knuff vore farlig, utan för att den är meningslös och
 * ser flitig ut. Fyra rader i någons klocka är inte fyra gångers påfart — det
 * är en chef som borde ha ringt i stället. Klockan visar högst tre knuffar av
 * samma skäl (`notiser-server.ts`).
 *
 * Spärren är bara för den här sidvisningen. Laddar man om går det att knuffa
 * igen, och det är avsiktligt: i morgon kan det vara rimligt.
 * ===========================================================================
 */
export function Knuffa({ employeeId }: { employeeId: string }) {
  const [sagt, setSagt] = useState(false);
  const [pagar, startOvergang] = useTransition();
  const router = useRouter();

  if (sagt) {
    return <span className="text-small text-ink-500">Sagt till</span>;
  }

  return (
    <Button
      size="sm"
      variant="sekundar"
      laddar={pagar}
      onClick={() =>
        startOvergang(async () => {
          await knuffa(employeeId);
          setSagt(true);
          router.refresh();
        })
      }
    >
      Knuffa
    </Button>
  );
}
