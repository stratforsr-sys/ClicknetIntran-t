import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cn } from "./cn";

type Variant = "primar" | "sekundar" | "diskret" | "destruktiv";
type Size = "md" | "sm";

/**
 * UI-PRD §5.4. En primarknapp per vy.
 * Minsta traffyta 44x44 px (AC-U5.5). Aktiv skala 0.98.
 */
const VARIANT: Record<Variant, string> = {
  primar:
    "bg-brand-600 text-ink-inv shadow-elev-brand hover:bg-brand-700 active:scale-[0.98]",
  sekundar:
    "bg-surface text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50 active:scale-[0.98]",
  diskret:
    "bg-transparent text-ink-500 hover:text-ink-900 hover:bg-surface-alt active:scale-[0.98]",
  destruktiv:
    "bg-danger text-ink-inv hover:brightness-95 active:scale-[0.98]",
};

const SIZE: Record<Size, string> = {
  md: "min-h-11 px-6 text-body",
  sm: "min-h-9 px-4 text-small",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold " +
  "transition-[background-color,transform,box-shadow] duration-fast ease-brand " +
  "disabled:pointer-events-none disabled:opacity-45";

export function Button({
  variant = "primar",
  size = "md",
  laddar = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  laddar?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || laddar}
      aria-busy={laddar || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
    >
      {/* Laddande knapp behaller sin bredd: texten byts, layouten hoppar inte. */}
      {laddar ? <Spinner /> : children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "sekundar",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={cn(BASE, VARIANT[variant], SIZE[size], className)}>
      {children}
    </Link>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}
