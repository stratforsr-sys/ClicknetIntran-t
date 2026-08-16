"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { loggaInMedLosenord, skickaMagiskLank, type LoginState } from "./actions";

const TOM: LoginState = {};

export default function LoggaIn() {
  const [metod, setMetod] = useState<"lank" | "losenord">("lank");
  const [lankState, skickaLank, lankVantar] = useActionState(skickaMagiskLank, TOM);
  const [losenState, loggaIn, losenVantar] = useActionState(loggaInMedLosenord, TOM);

  const state = metod === "lank" ? lankState : losenState;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-brand-900 font-display text-h1 leading-none text-brand-500">
            C
          </span>
          <h1 className="text-display text-ink-900">
            Clicknet <span className="text-brand-700">Nav</span>
          </h1>
          <p className="text-body text-ink-500">Vi leder dig mot din vision.</p>
        </div>

        <div className="rounded-md bg-surface p-6 shadow-elev-1">
          {lankState.skickat ? (
            <div className="flex flex-col gap-4">
              <Notis ton="ok">
                Länken är skickad. Öppna mejlet och klicka på länken för att logga in.
              </Notis>
              <p className="text-small text-ink-500">
                Länken gäller i en timme. Kolla skräpposten om den inte dykt upp inom någon minut.
              </p>
            </div>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Välj inloggningssätt"
                className="mb-6 flex gap-1 rounded-full bg-canvas p-1"
              >
                <Flik aktiv={metod === "lank"} onClick={() => setMetod("lank")}>
                  Magisk länk
                </Flik>
                <Flik aktiv={metod === "losenord"} onClick={() => setMetod("losenord")}>
                  Lösenord
                </Flik>
              </div>

              <form
                action={metod === "lank" ? skickaLank : loggaIn}
                className="flex flex-col gap-4"
              >
                <Field label="E-post" namn="epost" fel={state.fel}>
                  <Input
                    namn="epost"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="fornamn@clicknet.se"
                    fel={state.fel}
                  />
                </Field>

                {metod === "losenord" && (
                  <Field label="Lösenord" namn="losenord">
                    <Input
                      namn="losenord"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </Field>
                )}

                <Button type="submit" laddar={lankVantar || losenVantar} className="mt-2 w-full">
                  {metod === "lank" ? "Skicka inloggningslänk" : "Logga in"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-small text-ink-500">
          Saknar du konto? Be din chef lägga upp dig i navet.
        </p>
      </div>
    </main>
  );
}

function Flik({
  aktiv,
  onClick,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={aktiv}
      onClick={onClick}
      className={`min-h-9 flex-1 rounded-full text-small font-semibold transition-colors duration-fast ease-brand ${
        aktiv ? "bg-surface text-ink-900 shadow-elev-1" : "text-ink-500 hover:text-ink-900"
      }`}
    >
      {children}
    </button>
  );
}
