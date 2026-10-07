"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Field";
import { Filuppladdning } from "@/components/Filuppladdning";
import { forberedAvtalsfil, registreraAvtalsfil } from "../actions";

type Person = { id: string; namn: string };

/**
 * 0073. Person, rubrik och fil.
 *
 * Personen och rubriken följer med in i `Filuppladdning`s två steg som
 * stängningar, i stället för som fält i dess formulär — komponenten är delad
 * med intyg, bilagor och rollspel och vet bara om filen.
 *
 * Efter registreringen går vi till det nya avtalet. Där ser den som laddade upp
 * det exakt det den anställda kommer att se, och knappen för att dra tillbaka
 * det om filen blev fel.
 */
export function Bifoga({ personer, forvald }: { personer: Person[]; forvald: string }) {
  const [personId, setPersonId] = useState(forvald);
  const [titel, setTitel] = useState("Anställningsavtal");
  const router = useRouter();

  const vald = personer.find((p) => p.id === personId);

  return (
    <Card className="flex max-w-xl flex-col gap-4">
      <Field label="Anställd" namn="employee_id">
        <Select
          namn="employee_id"
          required
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">Välj person</option>
          {personer.map((p) => (
            <option key={p.id} value={p.id}>
              {p.namn}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Rubrik"
        namn="titel"
        hjalp="Det här står i listan och överst på avtalet, t.ex. ”Anställningsavtal 2026” eller ”Tillägg – provision”."
      >
        <Input namn="titel" value={titel} maxLength={200} onChange={(e) => setTitel(e.target.value)} />
      </Field>

      <div className="border-t border-canvas pt-2">
        <Filuppladdning
          andamal="employment_contract"
          etikett={vald ? `Avtalet för ${vald.namn}` : "Avtalet"}
          hjalp="PDF, JPG eller PNG."
          knapp="Ladda upp och publicera"
          forbered={(filnamn, mimetyp, storlek) =>
            forberedAvtalsfil(personId, filnamn, mimetyp, storlek)
          }
          registrera={async (fileId, filnamn, store) => {
            const svar = await registreraAvtalsfil(personId, titel, fileId, filnamn, store);
            if (svar.avtalId) router.push(`/avtal/${svar.avtalId}`);
            return { fel: svar.fel };
          }}
        />
      </div>
    </Card>
  );
}
