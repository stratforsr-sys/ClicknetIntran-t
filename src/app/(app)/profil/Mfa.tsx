"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Badge } from "@/components/ui/Badge";
import { skapaAterstallningskoder, loggaInskrivenFaktor } from "./actions";

type Steg = "vila" | "skriv-in" | "koder";

/**
 * Inskrivningen sker i webblasaren mot Supabase direkt. Hemligheten passerar
 * darmed aldrig var egen server — den finns hos Supabase och i telefonen, och
 * ingen annanstans.
 */
export function Mfa({
  harFaktor,
  obligatorisk,
  klarHref,
}: {
  harFaktor: boolean;
  obligatorisk: boolean;
  /** Vart anvandaren ska nar koderna ar sparade. Utan den stannar hon kvar. */
  klarHref?: string;
}) {
  const router = useRouter();
  const [steg, setSteg] = useState<Steg>("vila");
  const [qr, setQr] = useState<string | null>(null);
  const [hemlighet, setHemlighet] = useState<string | null>(null);
  const [faktorId, setFaktorId] = useState<string | null>(null);
  const [gamlaFaktorer, setGamlaFaktorer] = useState<string[]>([]);
  const [kod, setKod] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [koder, setKoder] = useState<string[] | null>(null);
  const [vantar, startaOvergang] = useTransition();
  const [arbetar, setArbetar] = useState(false);

  async function borja() {
    setFel(null);
    setArbetar(true);
    const supabase = supabaseBrowser();

    // Ett avbrutet forsok lamnar kvar en overifierad faktor. Den skrapar bara,
    // sa den stads bort direkt. Redan verifierade faktorer far daremot leva
    // tills den nya ar bekraftad — annars star den som byter telefon utan
    // andra faktor mitt i bytet.
    const { data: befintliga } = await supabase.auth.mfa.listFactors();
    const kvar: string[] = [];
    for (const f of befintliga?.all ?? []) {
      if (f.status === "verified") kvar.push(f.id);
      else await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    setGamlaFaktorer(kvar);

    // Inget friendlyName: Supabase kraver att det ar unikt per anvandare, och
    // vid telefonbyte finns den gamla faktorn kvar. issuer ar anda det som
    // visas i autentiseringsappen.
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "Clicknet Nav",
    });
    setArbetar(false);

    if (error || !data) {
      setFel(
        error?.message.toLowerCase().includes("disabled")
          ? "Tvåfaktor är avstängt i Supabase-projektet. Slå på TOTP under Authentication."
          : "Inskrivningen kunde inte påbörjas. Försök igen.",
      );
      return;
    }

    setFaktorId(data.id);
    setQr(data.totp.qr_code);
    setHemlighet(data.totp.secret);
    setSteg("skriv-in");
  }

  async function verifiera(e: React.FormEvent) {
    e.preventDefault();
    if (!faktorId) return;
    setFel(null);
    setArbetar(true);

    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: faktorId,
      code: kod.replace(/\s/g, ""),
    });
    setArbetar(false);

    if (error) {
      setFel("Koden stämmer inte. Kontrollera att telefonens klocka går rätt.");
      return;
    }

    // Den nya telefonen ar bekraftad. Nu, och forst nu, tappar den gamla sin
    // giltighet.
    for (const id of gamlaFaktorer) await supabase.auth.mfa.unenroll({ factorId: id });
    setGamlaFaktorer([]);

    // Ingen omritning har. Sidan under kan vara den obligatoriska grinden, och
    // den skickar vidare sa fort faktorn finns — da skulle koderna forsvinna
    // innan de lasts. Omritningen sker nar anvandaren sagt att hon sparat dem.
    startaOvergang(async () => {
      await loggaInskrivenFaktor();
      const svar = await skapaAterstallningskoder();
      setKoder(svar.koder ?? null);
      setSteg("koder");
    });
  }

  function nyaKoder() {
    startaOvergang(async () => {
      const svar = await skapaAterstallningskoder();
      if (svar.fel) setFel(svar.fel);
      else {
        setKoder(svar.koder ?? null);
        setSteg("koder");
      }
    });
  }

  if (steg === "koder" && koder) {
    return (
      <div className="flex flex-col gap-4">
        <Notis ton="warn">
          Skriv av koderna och lägg dem där du förvarar viktiga papper. De visas aldrig igen.
        </Notis>
        <ul className="grid grid-cols-2 gap-2 rounded-sm bg-canvas p-4 font-mono text-body text-ink-900">
          {koder.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
        <p className="text-small text-ink-500">
          Varje kod fungerar en gång. En kod tar bort tvåfaktorn så att du kan skriva in en ny
          telefon — den loggar dig inte in på egen hand.
        </p>
        <div>
          <Button
            variant="sekundar"
            onClick={() => {
              setSteg("vila");
              setKoder(null);
              if (klarHref) router.push(klarHref);
              else router.refresh();
            }}
          >
            Klart, jag har sparat dem
          </Button>
        </div>
      </div>
    );
  }

  if (steg === "skriv-in" && qr) {
    return (
      <form onSubmit={verifiera} className="flex flex-col gap-4">
        <p className="text-body text-ink-700">
          Skanna rutan i din autentiseringsapp — Google Authenticator, Microsoft Authenticator
          eller 1Password fungerar alla.
        </p>
        {/* Rutan kommer som SVG fran Supabase och ritas lokalt. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/svg+xml;utf-8,${qr}`}
          alt="QR-kod för inskrivning av tvåfaktor"
          width={192}
          height={192}
          className="size-48 self-start rounded-sm bg-surface p-2 shadow-elev-1"
        />
        <details className="text-small text-ink-500">
          <summary className="cursor-pointer">Kan du inte skanna?</summary>
          <p className="mt-2 break-all font-mono text-ink-700">{hemlighet}</p>
        </details>

        <Field label="Sexsiffrig kod från appen" namn="kod" fel={fel ?? undefined}>
          <Input
            namn="kod"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            fel={fel ?? undefined}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" laddar={arbetar || vantar}>
            Bekräfta och aktivera
          </Button>
          <Button type="button" variant="diskret" onClick={() => setSteg("vila")}>
            Avbryt
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {harFaktor ? (
          <Badge ton="ok">Aktiv</Badge>
        ) : obligatorisk ? (
          <Badge ton="danger">Krävs för din roll</Badge>
        ) : (
          <Badge ton="warn">Inte aktiv</Badge>
        )}
        <p className="text-small text-ink-500">
          {harFaktor
            ? "Inloggning kräver en kod från din app."
            : "En kod från din telefon utöver lösenordet."}
        </p>
      </div>

      {fel && <Notis ton="danger">{fel}</Notis>}

      <div className="flex flex-wrap gap-2">
        {harFaktor ? (
          <>
            <Button variant="sekundar" onClick={nyaKoder} laddar={vantar}>
              Skapa nya återställningskoder
            </Button>
            <Button variant="sekundar" onClick={borja} laddar={arbetar}>
              Byt telefon
            </Button>
          </>
        ) : (
          <Button onClick={borja} laddar={arbetar}>
            Aktivera tvåfaktor
          </Button>
        )}
      </div>
    </div>
  );
}
