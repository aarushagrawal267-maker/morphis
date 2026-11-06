/** Minimal original line icons (stroke = currentColor). */
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  core: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
    </>
  ),
  tower: <path d="M6 22V6l6-4 6 4v16M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1M4 22h16" />,
  book: <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13" />,
  flask: <path d="M9 2h6M10 2v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-11V2M7 14h10" />,
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4M10 10h4v4h-4z" />
    </>
  ),
  briefcase: <path d="M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18" />,
  bank: <path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18" />,
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10zM9 11h2V9h2v2h2v2h-2v2h-2v-2H9z" />,
  palette: <path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-3.9-4-7.2-9-7.2zM7.5 11h.01M10 7.5h.01M15 7.5h.01" />,
  home: <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" />,
  music: <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" />,
  bus: <path d="M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 11h14M7 19v2M17 19v2M5 16h14v3H5zM8 14h.01M16 14h.01" />,
  factory: <path d="M3 21V10l5 3V10l5 3V10l5 3V4h3v17zM7 17h2M12 17h2M17 17h2" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  play: <path d="M7 4v16l13-8z" />,
  pause: <path d="M7 4h4v16H7zM13 4h4v16h-4z" />,
  pin: <path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  story: <path d="M4 4h12l4 4v12H4zM8 10h8M8 14h8M8 18h5" />,
  walk: <path d="M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7 3 3v6M8 12l2-5 4 1 3 4M10 7l-3 3" />,
  door: <path d="M5 21V3h11l3 2v16M5 21h15M13 12h.01" />,
  car: <path d="M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v2M17 19v2M7 13.5h.01M17 13.5h.01" />,
  sun: <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />,
  cursor: <path d="M4 3l7 18 2.5-7.5L21 11z" />,
  bell: <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  focus: <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 9v6M9 12h6" />,
  save: <path d="M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7" />,
  gear: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />,
  bug: <path d="M8 2l2 2M16 2l-2 2M9 7h6a3 3 0 0 1 3 3v4a6 6 0 0 1-12 0v-4a3 3 0 0 1 3-3zM12 7v14M3 13h3M18 13h3M4 8l3 2M20 8l-3 2M4 20l3-2M20 20l-3-2" />,
  terminal: <path d="M4 5h16v14H4zM7 9l3 3-3 3M12 15h5" />,
  cloud: <path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" />,
  rain: <path d="M7 14a5 5 0 1 1 1-9.9A6 6 0 0 1 19 6a4 4 0 0 1-1 8zM8 18l-1 3M12 18l-1 3M16 18l-1 3" />,
  fog: <path d="M4 10h16M3 14h18M5 18h14M7 6h10" />,
  storm: <path d="M7 14a5 5 0 1 1 1-9.9A6 6 0 0 1 19 6a4 4 0 0 1-1 8zM13 14l-3 4h4l-2 4" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
  task: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  layers: <path d="M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5" />,
  map: <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />,
  exit: <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11" />,
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name] ?? P.core}
    </svg>
  );
}

export function DistrictIcon({ name }: { name: string }) {
  return <Icon name={name} size={18} />;
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Morphis logo">
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
      </defs>
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="none" stroke="url(#mg)" strokeWidth="3" />
      <path d="M18 44V22l14 11 14-11v22" fill="none" stroke="url(#mg)" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="32" cy="33" r="3.2" fill="#e879f9" />
    </svg>
  );
}
