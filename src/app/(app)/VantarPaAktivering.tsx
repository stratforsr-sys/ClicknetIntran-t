import { Card } from "@/components/ui/Card";

/** AC-1.2 */
export function VantarPaAktivering({ epost }: { epost: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <Card className="w-full max-w-[30rem] text-center">
        <h1 className="text-h1 text-ink-900">Väntar på aktivering</h1>
        <p className="mt-3 text-body text-ink-500">
          Du är inloggad som <span className="font-semibold text-ink-700">{epost}</span>, men du är
          ännu inte upplagd som anställd. Säg till din chef så tar det en minut.
        </p>
        <form action="/auth/logga-ut" method="post" className="mt-6">
          <button
            type="submit"
            className="text-small font-semibold text-brand-700 underline-offset-4 hover:underline"
          >
            Logga ut
          </button>
        </form>
      </Card>
    </main>
  );
}
