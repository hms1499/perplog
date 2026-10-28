import type { ReactNode } from "react";

// 16px line icons for the account sections. Decorative: the link text names the section.

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** A pulse line: the account's vital sign. */
export const HealthIcon = () => (
  <Icon>
    <path d="M1.5 8.5h3l1.5-4 3 8 1.5-4h4" />
  </Icon>
);

export const JournalIcon = () => (
  <Icon>
    <path d="M3 2.5h8.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12V2.5Z" />
    <path d="M6 6h4M6 8.5h4" />
  </Icon>
);

/** A drop: money leaking out. */
export const LeaksIcon = () => (
  <Icon>
    <path d="M8 1.75c2.5 3 4 5.1 4 7.25a4 4 0 0 1-8 0c0-2.15 1.5-4.25 4-7.25Z" />
  </Icon>
);

export const PositionsIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M2 6.5h12M6 6.5v7" />
  </Icon>
);

/** A crosshair: aim the entry and the stop. */
export const PlanIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
  </Icon>
);

export const ReportIcon = () => (
  <Icon>
    <path d="M2.5 13.5h11" />
    <path d="M4.5 11V8M8 11V4.5M11.5 11V6.5" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.75A1.25 1.25 0 0 0 9.25 2.5h-5.5A1.25 1.25 0 0 0 2.5 3.75v5.5a1.25 1.25 0 0 0 1.25 1.25H5.5" />
  </Icon>
);
