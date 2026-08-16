import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

/** Delad av Input och Select. Exporterad for de fa formular som har flera
 *  identiska falt pa samma sida och darfor inte kan anvanda id per falt. */
export const KONTROLL =
  "w-full rounded-sm bg-surface px-4 py-2.5 text-body text-ink-900 " +
  "shadow-elev-1 ring-1 ring-transparent placeholder:text-ink-300 " +
  "transition-shadow duration-fast ease-brand " +
  "focus:shadow-elev-2 focus:outline-none focus:ring-2 focus:ring-brand-600";

/** AC-U5.6: formularfel kopplas till faltet med aria-describedby. */
export function Field({
  label,
  namn,
  fel,
  hjalp,
  children,
}: {
  label: string;
  namn: string;
  fel?: string;
  hjalp?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={namn} className="text-small font-semibold text-ink-700">
        {label}
      </label>
      {children}
      {hjalp && !fel && (
        <p id={`${namn}-hjalp`} className="text-small text-ink-500">
          {hjalp}
        </p>
      )}
      {fel && (
        <p id={`${namn}-fel`} className="text-small text-danger-ink">
          {fel}
        </p>
      )}
    </div>
  );
}

export function Input({
  namn,
  fel,
  hjalp,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { namn: string; fel?: string; hjalp?: string }) {
  return (
    <input
      {...rest}
      id={namn}
      name={namn}
      aria-invalid={fel ? true : undefined}
      aria-describedby={fel ? `${namn}-fel` : hjalp ? `${namn}-hjalp` : undefined}
      className={cn(KONTROLL, fel && "ring-2 ring-danger", className)}
    />
  );
}

export function Select({
  namn,
  fel,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { namn: string; fel?: string }) {
  return (
    <select
      {...rest}
      id={namn}
      name={namn}
      aria-invalid={fel ? true : undefined}
      aria-describedby={fel ? `${namn}-fel` : undefined}
      className={cn(KONTROLL, "appearance-none pr-10", fel && "ring-2 ring-danger", className)}
    >
      {children}
    </select>
  );
}
