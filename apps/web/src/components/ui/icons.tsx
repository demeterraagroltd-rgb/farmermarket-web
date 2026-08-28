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

export function DocumentIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 2.5h6l3 3V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3" />
      <path d="M7.5 10h5M7.5 12.5h5" />
    </svg>
  );
}

export function BankIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 7.5 10 3l7.5 4.5" />
      <path d="M3.5 7.5h13V16h-13V7.5Z" />
      <path d="M6 10.5V14M10 10.5V14M14 10.5V14" />
      <path d="M2.5 16h15" />
    </svg>
  );
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7.5 10 12.5 15 7.5" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3" />
      <path d="m5.5 5.5 2 2M14.5 5.5l-2 2M5.5 14.5l2-2M14.5 14.5l-2-2" />
    </svg>
  );
}

export function TruckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 5.5h8V14h-8V5.5Z" />
      <path d="M10.5 8h3.2L16 10.3V14h-5.5V8Z" />
      <circle cx="5.5" cy="15.5" r="1.5" />
      <circle cx="13" cy="15.5" r="1.5" />
    </svg>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 2.5 16 5v5c0 4-2.7 6.3-6 7.5C6.7 16.3 4 14 4 10V5l6-2.5Z" />
      <path d="m7.3 10 1.9 1.9 3.5-3.9" />
    </svg>
  );
}

export function WalletIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h9A1.5 1.5 0 0 1 15 5.5V6H4.5A1.5 1.5 0 0 1 3 4.5v1Z" />
      <path d="M3 6h12.5A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5V6Z" />
      <circle cx="13.5" cy="11" r="1.1" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="4" width="15" height="13" rx="1.5" />
      <path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3" />
    </svg>
  );
}

export function LeafIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 16c-.6-6.5 3-11 12-11 0 9-4.5 12.5-11 12" />
      <path d="M5.5 14.5 15 5" />
    </svg>
  );
}

export function PercentIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M15 5 5 15" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="14" cy="14" r="2" />
    </svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="15" height="10" rx="1.5" />
      <path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6" />
      <path d="M2.5 10.5h15" />
    </svg>
  );
}

export function CartIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 3h2l1.6 9.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.2L17 7H5.3" />
      <circle cx="8" cy="17" r="1.2" />
      <circle cx="14.5" cy="17" r="1.2" />
    </svg>
  );
}
