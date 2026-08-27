// Hand-rolled, not an icon library dependency — a handful of 20x20 stroke
// icons is cheap enough to own outright, and keeps the bundle self-contained.
// All share the same viewBox/stroke conventions so they sit flush together
// in the sidebar regardless of which one is active.

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function InboxIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 11.5 5 4h10l2 7.5" />
      <path d="M3 11.5h4.2c.3 1 1.2 1.7 2.3 1.7h1c1.1 0 2-.7 2.3-1.7H17" />
      <path d="M3 11.5V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4.5" />
    </svg>
  );
}

export function PeopleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="7.5" cy="6.5" r="2.5" />
      <path d="M2.5 17c0-2.8 2.2-5 5-5s5 2.2 5 5" />
      <circle cx="14.5" cy="7" r="2" />
      <path d="M13 12.2c2.3.4 4 2.4 4 4.8" />
    </svg>
  );
}

export function BoxIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3 3 6.5 10 10l7-3.5L10 3Z" />
      <path d="M3 6.5V14l7 3.5 7-3.5V6.5" />
      <path d="M10 10v7.5" />
    </svg>
  );
}

export function BadgeCheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 2.5 12 4l2.4-.3.9 2.2L17 7l-1 2.2L17 11.5l-1.7 1.6.3 2.4-2.4.6-.9 2.2-2.3-.7-2.3.7-.9-2.2-2.4-.6.3-2.4L3 11.5 4.7 9.3 3 7l1.7-1.1.9-2.2L8 4l2-1.5Z" />
      <path d="m7.3 10 1.9 1.9 3.5-3.9" />
    </svg>
  );
}

export function LogOutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" />
      <path d="M13 14l4-4-4-4" />
      <path d="M17 10H7.5" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10.5 8 14l8-8.5" />
    </svg>
  );
}
