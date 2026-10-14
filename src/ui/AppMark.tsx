import { useId } from "react";

/** The app icon as a mark: an orchestration tree whose root pulses, each branch in the brand color of its model. */
export function AppMark({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" role="img" aria-label="Agent Monitor" className="app-mark">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#262c3d" />
          <stop offset="1" stopColor="#10131b" />
        </linearGradient>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="190" fill={`url(#${id}-bg)`} />
      <g fill="none" stroke="#7b869d" strokeWidth="18" strokeLinecap="round" strokeOpacity="0.8">
        <path d="M512 340 C512 440 360 420 360 540" />
        <path d="M512 340 C512 440 664 420 664 540" />
        <path d="M360 560 C360 640 276 630 276 722" />
        <path d="M360 560 C360 640 444 630 444 722" />
        <path d="M664 560 C664 640 580 630 580 722" />
        <path d="M664 560 C664 640 748 630 748 722" />
      </g>
      <circle cx="512" cy="330" r="96" fill="none" stroke="#d97757" strokeOpacity="0.5" strokeWidth="14" />
      <circle cx="512" cy="330" r="62" fill="#d97757" />
      <circle cx="360" cy="544" r="50" fill="#10a37f" />
      <circle cx="664" cy="544" r="50" fill="#4285f4" />
      <circle cx="276" cy="738" r="38" fill="#0f8a6d" />
      <circle cx="444" cy="738" r="38" fill="#0f8a6d" />
      <circle cx="580" cy="738" r="38" fill="#3a74d6" />
      <circle cx="748" cy="738" r="38" fill="#3a74d6" />
    </svg>
  );
}
