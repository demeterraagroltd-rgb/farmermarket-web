import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const fieldClass =
  "w-full rounded-[var(--radius-sm)] border border-dark-border/60 bg-white px-3 py-2 text-sm text-text-dark placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

function Label({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">{children}</span>;
}

export function Input({ label, ...props }: { label?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      {label && <Label>{label}</Label>}
      <input className={fieldClass} {...props} />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: { label?: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      {label && <Label>{label}</Label>}
      <select className={fieldClass} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Textarea({
  label,
  ...props
}: { label?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      {label && <Label>{label}</Label>}
      <textarea className={fieldClass} {...props} />
    </label>
  );
}
