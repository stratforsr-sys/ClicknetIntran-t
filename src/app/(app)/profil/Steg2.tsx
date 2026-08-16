"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { glomEnheten } from "./actions";

/**
 * Det finns inget att skriva in och inget att spara: koden kommer till mejlen
 * nar den behovs. Kortet visar darfor bara laget, plus en vag att glomma just
 * den har enheten — den enda knapp som gor nagon nytta.
 */
export function Steg2({
  obligatorisk,
  enhetenIhagkommen,
}: {
  obligatorisk: boolean;
  enhetenIhagkommen: boolean;
}) {
  const router = useRouter();
  const [vantar, start] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {obligatorisk ? <Badge ton="ok">På</Badge> : <Badge ton="neutral">Behövs inte</Badge>}
        <p className="text-small text-ink-500">
          {obligatorisk
            ? "Vid inloggning på en ny enhet skickas en kod till din mejl."
            : "Din roll når inga känsliga uppgifter, så navet frågar inte efter någon kod."}
        </p>
      </div>

      {obligatorisk && enhetenIhagkommen && (
        <>
          <p className="text-small text-ink-500">
            Den här enheten är bekräftad och slipper koden i 30 dagar. Sitter du vid en dator du
            inte äger — glöm den här.
          </p>
          <div>
            <Button
              variant="sekundar"
              laddar={vantar}
              onClick={() =>
                start(async () => {
                  await glomEnheten();
                  router.refresh();
                })
              }
            >
              Glöm den här enheten
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
