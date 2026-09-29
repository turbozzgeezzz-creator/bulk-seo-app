// Inline icons for BulkFlow's custom elements (Polaris components use s-icon).
type P = { size?: number; className?: string };
const svg = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  className,
});

export const IImage = ({ size = 20, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);
export const ISearch = ({ size = 20, className }: P) => (
  <svg {...svg(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const IArrow = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const ICheck = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IAlert = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);
export const ISkip = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M5 5v14M9 12l10-7v14l-10-7Z" />
  </svg>
);
export const ISparkle = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
);
export const IShield = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const IRefresh = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </svg>
);
export const IStop = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
export const IPause = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
export const IStack = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);
export const IEye = ({ size = 16, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const IRewrite = ({ size = 20, className }: P) => (
  <svg {...svg(size, className)}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);
export const IFill = ({ size = 20, className }: P) => (
  <svg {...svg(size, className)}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M8 12h8M12 8v8" />
  </svg>
);
