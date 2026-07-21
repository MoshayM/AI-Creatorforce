import { useId } from 'react';

interface LogoMarkProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Blueforce logo mark — shared across every surface.
 * Uses useId() so SVG gradient IDs never collide when rendered multiple times per page.
 */
export function LogoMark({ className, style }: LogoMarkProps) {
  const raw = useId();
  const uid = raw.replace(/:/g, 'lm');

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <defs>
        {/* Rich violet → deep indigo */}
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A855F7" />
          <stop offset="1" stopColor="#3B0F9E" />
        </linearGradient>
        {/* Subtle top-left inner highlight for depth */}
        <radialGradient id={`${uid}-hl`} cx="28%" cy="22%" r="58%">
          <stop stopColor="white" stopOpacity="0.22" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        {/* Soft inner glow at bolt tip */}
        <radialGradient id={`${uid}-glow`} cx="62%" cy="28%" r="35%">
          <stop stopColor="#E9D5FF" stopOpacity="0.35" />
          <stop offset="1" stopColor="#E9D5FF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Background */}
      <rect width="40" height="40" rx="10" fill={`url(#${uid}-bg)`} />
      <rect width="40" height="40" rx="10" fill={`url(#${uid}-hl)`} />
      <rect width="40" height="40" rx="10" fill={`url(#${uid}-glow)`} />

      {/*
        Force bolt — geometric lightning bolt polygon.
        Centered in the 40×40 canvas with balanced margins.
        Upper section (top-right) tapers into lower section (bottom-left).
      */}
      <path
        d="M 21,8 L 28,8 L 20,22 L 27,22 L 12,34 L 20,20 L 13,20 Z"
        fill="white"
      />
    </svg>
  );
}
