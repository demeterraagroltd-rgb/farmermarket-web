"use client";

import { useState } from "react";
import { ChevronDownIcon } from "../ui/icons";

interface FaqItem {
  question: string;
  answer: string;
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div
            key={item.question}
            className={`overflow-hidden rounded-[var(--radius-lg)] border transition-colors ${
              open ? "border-primary/30 bg-primary-surface/40" : "border-dark-border/60 bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="font-semibold text-text-dark">{item.question}</span>
              <ChevronDownIcon
                className={`h-5 w-5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180 text-primary" : ""}`}
              />
            </button>
            {open && <p className="px-5 pb-4 text-sm leading-relaxed text-text-medium">{item.answer}</p>}
          </div>
        );
      })}
    </div>
  );
}
