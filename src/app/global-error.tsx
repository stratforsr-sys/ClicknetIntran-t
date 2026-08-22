"use client";

import { Felgrans } from "@/components/Felgrans";
import "./globals.css";

/**
 * E0.6. Sista utvagen: felet lag i rotlayouten, sa det finns inget skal kvar
 * att rita innehallet i. Darfor egen `<html>` och egen `<body>`.
 *
 * Filen ar med flit tunn. Allt som kan ga sonder i den tar med sig hela navet
 * — det finns ingen grans utanfor den har.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sv">
      <body className="bg-canvas text-ink-900">
        <Felgrans error={error} reset={reset} />
      </body>
    </html>
  );
}
