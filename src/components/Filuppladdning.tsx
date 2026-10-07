"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MAX_BYTE, accept, provaFil, type Andamal } from "@/lib/filer";

/**
 * ===========================================================================
 * FILEN GAR DIREKT TILL BUCKETEN, INTE GENOM NAVET.
 *
 * Vercel tar emot hogst 4,5 MB i kroppen till en serverlos funktion, och en
 * server action ar en sadan. En intygssida fotograferad med telefon ar ofta
 * storre, en kvart inspelat samtal alltid. Gick filen genom servern skulle
 * felet komma fran plattformen, med ett meddelande som inte sager nagot om
 * vad anvandaren gjorde.
 *
 * Tre steg, och alla tre kan misslyckas var for sig:
 *
 *   1. `forbered` ar en server action som kontrollerar behorigheten och ger
 *      en signerad uppladdningslank. Den lanken duger till EN fil pa EN
 *      sokvag och gar inte att aterbruka.
 *   2. Webblasaren lagger filen i bucketen med den lanken.
 *   3. `registrera` ar en server action som fragar Storage vad som faktiskt
 *      kom in, provar reglerna mot det, och skriver raden.
 *
 * Det ar forst efter steg 3 filen finns for navet — hela vagen till innehallet
 * gar genom `file_object`. En fil som stannar mellan steg 2 och 3 ar darfor
 * osynlig, inte trasig.
 * ===========================================================================
 */
export function Filuppladdning({
  andamal,
  etikett,
  hjalp,
  forbered,
  registrera,
  knapp = "Ladda upp",
}: {
  andamal: Andamal;
  etikett: string;
  hjalp?: string;
  /** Server action. Ger en signerad lank, eller ett fel. */
  forbered: (
    filnamn: string,
    mimetyp: string,
    storlek: number,
  ) => Promise<
    | { fileId: string; store: string; bucket: string; path: string; token: string; url: string }
    | { fel: string }
  >;
  /**
   * Server action. Skriver raden efter att filen kommit fram.
   *
   * `store` foljer med tillbaka for att steg 3 ska leta dar steg 1 faktiskt
   * lade filen — inte dar en ny fil hade hamnat om en deploy hunnit emellan.
   */
  registrera: (fileId: string, filnamn: string, store: string) => Promise<{ fel?: string }>;
  knapp?: string;
}) {
  const falt = useRef<HTMLInputElement>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [laddar, setLaddar] = useState(false);
  const [, startaOvergang] = useTransition();
  const router = useRouter();

  const idFalt = `fil_${andamal}_${etikett.replace(/\W+/g, "")}`;

  async function skicka(e: React.FormEvent) {
    e.preventDefault();
    const fil = falt.current?.files?.[0];
    if (!fil) {
      setFel("Välj en fil först.");
      return;
    }

    // Samma regler som servern kor, men har for att slippa ladda upp fyrtio
    // megabyte innan beskedet. Servern ar den som avgor.
    const tidigt = provaFil(andamal, { type: fil.type, size: fil.size });
    if (tidigt) {
      setFel(tidigt.text);
      return;
    }

    setFel(null);
    setLaddar(true);
    try {
      const lank = await forbered(fil.name, fil.type, fil.size);
      if ("fel" in lank) {
        setFel(lank.fel);
        return;
      }

      // Två lagringar, två sätt att lägga in en fil — se `skickaTillLagring`.
      const lagringsfel = await skickaTillLagring(lank, fil);
      if (lagringsfel) {
        setFel(lagringsfel);
        return;
      }

      const svar = await registrera(lank.fileId, fil.name, lank.store);
      if (svar.fel) {
        setFel(svar.fel);
        return;
      }

      if (falt.current) falt.current.value = "";
      startaOvergang(() => router.refresh());
    } catch (err) {
      setFel(err instanceof Error ? err.message : "Uppladdningen misslyckades.");
    } finally {
      setLaddar(false);
    }
  }

  return (
    <form onSubmit={skicka} className="mt-3 flex flex-wrap items-end gap-2">
      {fel && (
        <div className="w-full">
          <Notis ton="danger">{fel}</Notis>
        </div>
      )}

      <label htmlFor={idFalt} className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">{etikett}</span>
        <input
          ref={falt}
          id={idFalt}
          name="fil"
          type="file"
          accept={accept(andamal)}
          className={`${KONTROLL} max-w-72 py-1.5 text-small`}
        />
      </label>

      <Button type="submit" size="sm" variant="sekundar" laddar={laddar}>
        {knapp}
      </Button>

      <p className="w-full text-micro text-ink-500">
        {hjalp ? `${hjalp} ` : ""}
        Högst {MAX_BYTE[andamal] / 1024 / 1024} MB.
      </p>
    </form>
  );
}

/**
 * Bytena till lagringen, efter att servern oppnat vagen (`forbered`). Delad
 * med orderformularets avtalsfalt (0075), som laddar upp innan ordern finns.
 * Returnerar ett felmeddelande, eller null nar filen kom fram.
 *
 * TVA LAGRINGAR, TVA SATT ATT LAGGA IN EN FIL. R2 ger en fardig PUT-adress;
 * Supabase ger en token som bara dess egen klient forstar. Vilket det blir
 * sager `lank.store`, och det kommer fran servern — den vet vilken vag den
 * faktiskt oppnade.
 */
export async function skickaTillLagring(
  lank: { store: string; bucket: string; path: string; token: string; url: string },
  fil: File,
): Promise<string | null> {
  if (lank.store === "r2") {
    const svar = await fetch(lank.url, { method: "PUT", body: fil, headers: { "content-type": fil.type } });
    return svar.ok ? null : `Filen kom inte fram: lagringen svarade ${svar.status}.`;
  }
  const { error } = await supabaseBrowser()
    .storage.from(lank.bucket)
    .uploadToSignedUrl(lank.path, lank.token, fil, { contentType: fil.type });
  return error ? `Filen kom inte fram: ${error.message}` : null;
}

