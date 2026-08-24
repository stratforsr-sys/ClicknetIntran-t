import { DesignInnehall } from "./Innehall";

export default function Designsystem() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Designsystem</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Alla primitiver i systemet. Ändras en token i <code>globals.css</code> ändras allt här.
        </p>
      </div>

      <DesignInnehall />
    </div>
  );
}
