"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { anvandAterstallningskod, type ProfilState } from "@/app/(app)/profil/actions";

const TOM: ProfilState = {};

export function Verifiera({ faktorId, nasta }: { faktorId: string; nasta: string }) {
  const router = useRouter();
  const [kod, setKod] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [arbetar, setArbetar] = useState(false);
  const [visaKod, setVisaKod] = useState(false);
  const [aterstall, skickaAterstall, aterstallVantar] = useActionState(
    anvandAterstallningskod,
    TOM,
  );

  async function verifiera(e: React.FormEvent) {
    e.preventDefault();
    setFel(null);
    setArbetar(true);
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({
      factorId: faktorId,
      code: kod.replace(/\s/g, ""),
    });
    setArbetar(false);
    if (error) {
      setFel("Koden stämmer inte. Den byts var trettionde sekund — pröva den nya.");
      return;
    }
    router.replace(nasta);
    router.refresh();
  }

  // Aterstallningen tog bort faktorn. Da finns inget kvar att verifiera har,
  // och anvandaren ska vidare till inskrivningen av en ny.
  if (aterstall.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Notis ton="ok">{aterstall.ok}</Notis>
        <Button
          onClick={() => {
            router.replace("/");
            router.refresh();
          }}
        >
          Fortsätt
        </Button>
      </div>
    );
  }

  if (visaKod) {
    return (
      <form action={skickaAterstall} className="flex flex-col gap-4">
        <p className="text-body text-ink-700">
          Skriv in en av koderna du fick när du aktiverade tvåfaktor. Den tar bort tvåfaktorn så
          att du kan skriva in en ny telefon.
        </p>
        <Field label="Återställningskod" namn="kod" fel={aterstall.fel}>
          <Input namn="kod" autoComplete="off" placeholder="XXXXX-XXXXX" required fel={aterstall.fel} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" laddar={aterstallVantar}>
            Använd koden
          </Button>
          <Button type="button" variant="diskret" onClick={() => setVisaKod(false)}>
            Tillbaka
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={verifiera} className="flex flex-col gap-4">
      <Field label="Sexsiffrig kod från din app" namn="kod" fel={fel ?? undefined}>
        <Input
          namn="kod"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          required
          value={kod}
          onChange={(e) => setKod(e.target.value)}
          fel={fel ?? undefined}
        />
      </Field>
      <Button type="submit" laddar={arbetar} className="w-full">
        Logga in
      </Button>
      <button
        type="button"
        onClick={() => setVisaKod(true)}
        className="text-small text-ink-500 underline hover:text-ink-900"
      >
        Har du inte telefonen? Använd en återställningskod
      </button>
    </form>
  );
}
