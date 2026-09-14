"use client";

import { useEffect, useState } from "react";
import { Ikon } from "@/components/shell/Ikon";
import { cn } from "@/components/ui/cn";
import { PLING_NYCKEL, plingetPa, sattPling } from "@/components/shell/pling";

/**
 * Knappen som slår på plinget.
 *
 * =============================================================================
 * BEHÖRIGHETEN MÅSTE BEGÄRAS AV EN MÄNNISKA SOM TRYCKT PÅ NÅGOT
 *
 * `Notification.requestPermission()` avvisas av Chrome, Safari och Firefox om
 * den anropas utan en användargest. Det finns alltså inget sätt att "bara slå
 * på det" vid sidladdning, och det är riktigt tänkt av webbläsarna: en ruta som
 * frågar om notiser innan man gjort något är den mest bortklickade rutan på
 * webben, och ett nej är permanent.
 *
 * Därför en knapp, och därför står den på KALENDERSIDAN och inte i skalet. Den
 * som just lagt ut sin dag är den enda som vet vad ett pling skulle vara till
 * för, och det är då frågan går att svara ja på.
 *
 * NEKAD ÄR INTE SAMMA SAK SOM AV. Har man sagt nej går det inte att fråga igen
 * från koden — webbläsaren släpper inte fram en andra förfrågan — och knappen
 * säger det rakt ut i stället för att se trasig ut.
 * =============================================================================
 */
export function Plingknapp() {
  const [lage, setLage] = useState<"okant" | "av" | "pa" | "nekad" | "saknas">("okant");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setLage("saknas");
      return;
    }
    if (Notification.permission === "denied") {
      setLage("nekad");
      return;
    }
    setLage(plingetPa() && Notification.permission === "granted" ? "pa" : "av");
  }, []);

  // Ritas inte förrän webbläsaren svarat. En knapp som hinner stå "Av" en
  // sekund och sedan hoppa till "På" ser ut att ha slagits om av sig själv.
  if (lage === "okant" || lage === "saknas") return null;

  if (lage === "nekad") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-small text-ink-300">
        <Ikon namn="klocka" className="size-4" />
        Pling blockerat i webbläsaren
      </span>
    );
  }

  const sla = async () => {
    if (lage === "pa") {
      sattPling(false);
      setLage("av");
      return;
    }

    const svar =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();

    if (svar !== "granted") {
      setLage(svar === "denied" ? "nekad" : "av");
      return;
    }

    sattPling(true);
    setLage("pa");

    // Ett kvitto på att det faktiskt fungerar. Utan det är enda sättet att veta
    // om knappen gjorde något att vänta till nästa uppgift — och den som inte
    // ser något händer slår av det igen.
    new Notification("Pling är på", {
      body: "Du får en påminnelse tio minuter innan en uppgift ska börja, så länge navet är öppet.",
      tag: PLING_NYCKEL,
    });
  };

  return (
    <button
      type="button"
      onClick={sla}
      aria-pressed={lage === "pa"}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-small transition-colors duration-fast",
        lage === "pa"
          ? "bg-brand-100 text-brand-700"
          : "bg-canvas text-ink-700 hover:bg-brand-100 hover:text-brand-700",
      )}
    >
      <Ikon namn="klocka" className="size-4" />
      {lage === "pa" ? "Pling på" : "Pling av"}
    </button>
  );
}
