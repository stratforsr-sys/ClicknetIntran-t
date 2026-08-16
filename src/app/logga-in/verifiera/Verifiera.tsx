"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { skickaKod, verifieraKod, type ProfilState } from "@/app/(app)/profil/actions";

const TOM: ProfilState = {};

export function Verifiera({ epost, nasta }: { epost: string; nasta: string }) {
  const router = useRouter();
  const [skickat, skicka, skickar] = useActionState(skickaKod, TOM);
  const [svar, verifiera, verifierar] = useActionState(verifieraKod, TOM);

  // Kvittot ligger i en kaka som satts av server actionen. Sidan under maste
  // ritas om for att mellanvaran ska se den.
  useEffect(() => {
    if (svar.ok) {
      router.replace(nasta);
      router.refresh();
    }
  }, [svar.ok, nasta, router]);

  return (
    <div className="flex flex-col gap-5">
      {skickat.ok && <Notis ton="ok">{skickat.ok}</Notis>}
      {skickat.fel && <Notis ton="danger">{skickat.fel}</Notis>}

      {!skickat.ok ? (
        <form action={skicka} className="flex flex-col gap-4">
          <p className="text-body text-ink-700">
            Vi skickar en engångskod till <strong className="text-ink-900">{epost}</strong>.
          </p>
          <Button type="submit" laddar={skickar} className="w-full">
            Skicka koden
          </Button>
        </form>
      ) : (
        <form action={verifiera} className="flex flex-col gap-4">
          <Field label="Koden från mejlet" namn="kod" fel={svar.fel}>
            <Input
              namn="kod"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              autoFocus
              required
              fel={svar.fel}
            />
          </Field>
          <Button type="submit" laddar={verifierar || Boolean(svar.ok)} className="w-full">
            Fortsätt
          </Button>
        </form>
      )}

      {skickat.ok && (
        <form action={skicka}>
          <button
            type="submit"
            disabled={skickar}
            className="text-small text-ink-500 underline hover:text-ink-900 disabled:opacity-45"
          >
            Skicka en ny kod
          </button>
        </form>
      )}

      <p className="text-small text-ink-500">
        Enheten kommer ihåg dig i 30 dagar. Sedan frågar vi igen.
      </p>
    </div>
  );
}
