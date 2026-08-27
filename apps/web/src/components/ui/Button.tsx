import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark disabled:bg-primary/50",
  // The brand's secondary color is gold/orange (--color-gold), not another
  // shade of green — was unused everywhere before this, so redefining it
  // here doesn't touch any existing call site.
  secondary:
    "border-2 border-gold text-gold-dark hover:bg-gold/10 disabled:opacity-50",
  ghost: "text-text-medium hover:bg-surface disabled:opacity-50",
  danger: "bg-error text-white hover:brightness-95 disabled:bg-error/50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
