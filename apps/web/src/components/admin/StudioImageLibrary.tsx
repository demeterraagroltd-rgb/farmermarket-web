"use client";

const STUDIO_IMAGES = [
  ["1000191366", "BUA Rice 50kg"], ["1000191367", "Jaaf Rice 50kg"],
  ["1000191368", "Optimum Rice 50kg"], ["1000191369", "Zyn Rice 50kg"],
  ["1000191370", "Supreme Semolina 10kg"], ["1000191371", "Star Oil 10L"],
  ["1000191372", "Indomie Hungry Man carton"], ["1000191373", "Mixed cartons (group photo)"],
  ["1000191374", "Gino Party Jollof carton"], ["1000191377", "Cooking oil (group photo)"],
  ["1000191378", "Star Oil 25L"], ["1000191379", "Emperor Oil 25L"],
  ["1000191380", "Zyn Oil (confirm capacity)"],
] as const;

export function StudioImageLibrary({ onSelect }: { onSelect: (url: string) => void }) {
  return <details className="rounded-lg border border-dark-border/60 p-3">
    <summary className="cursor-pointer text-sm font-semibold text-primary">Choose from 13 studio images</summary>
    <p className="my-2 text-xs text-text-muted">Check the label and size against the product. Group images show multiple products.</p>
    <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
      {STUDIO_IMAGES.map(([id, name]) => <button key={id} type="button" aria-label={name} onClick={() => onSelect(new URL(`/catalog/studio/${id}-studio.png`, window.location.origin).href)} className="rounded border border-dark-border/60 p-2 text-left text-xs hover:border-primary focus-visible:outline-primary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/catalog/studio/${id}-studio.png`} alt={name} loading="lazy" className="mb-2 h-24 w-full bg-white object-contain" />
        {name}
      </button>)}
    </div>
  </details>;
}
