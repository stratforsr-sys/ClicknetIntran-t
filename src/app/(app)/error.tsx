"use client";

import { Felgrans } from "@/components/Felgrans";

/**
 * E0.6. Felgrans for hela den inloggade delen.
 *
 * Ligger pa gruppen och inte pa varje modul med flit: en grans per modul hade
 * gett trettio filer som sager samma sak och som glider isar, och den forsta
 * modul nagon glommer ar den som kraschar.
 *
 * Skalet star kvar runt den har vyn — sidopanelen, notisklockan och
 * bottenraden fungerar. Det ar hela skillnaden mot global-error: en trasig
 * modul ska inte se ut som ett trasigt nav.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <Felgrans error={error} reset={reset} />;
}
