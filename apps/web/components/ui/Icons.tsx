'use client';
import React from 'react';

type IconProps = { size?: number; className?: string; color?: string };

const icon = (path: React.ReactNode, viewBox = '0 0 24 24') =>
  function Icon({ size = 20, className, color = 'currentColor' }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        color={color}
      >
        {path}
      </svg>
    );
  };

export const IconHome = icon(
  <><path d="M3 12L12 3l9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M9 21V12h6v9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M5 10.5V21h14V10.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconSend = icon(
  <><path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconReceive = icon(
  <><path d="M12 5v14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M19 12l-7 7-7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconSwap = icon(
  <><path d="M7 16V4m0 0L3 8m4-4l4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  <path d="M17 8v12m0 0l4-4m-4 4l-4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconHistory = icon(
  <><path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M3.05 11a9 9 0 1 0 .5-3M3 4v4h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconSettings = icon(
  <><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.75"/></>
);

export const IconCopy = icon(
  <><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconQR = icon(
  <><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75"/>
  <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75"/>
  <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M14 14h2v2h-2zM18 14h3M14 18h2M18 18h3v3M14 21h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconChevronRight = icon(
  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
);

export const IconChevronDown = icon(
  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
);

export const IconSearch = icon(
  <><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconClose = icon(
  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
);

export const IconCheck = icon(
  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
);

export const IconWallet = icon(
  <><rect x="2" y="5" width="20" height="15" rx="2" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M16 12a1 1 0 1 0 2 0 1 1 0 0 0-2 0z" fill="currentColor"/>
  <path d="M2 10h20" stroke="currentColor" strokeWidth="1.75"/></>
);

export const IconLink = icon(
  <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconAlert = icon(
  <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconEye = icon(
  <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.75"/>
  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/></>
);

export const IconEyeOff = icon(
  <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconPlus = icon(
  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
);

export const IconArrowUpRight = icon(
  <><path d="M7 17L17 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M7 7h10v10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconArrowDownLeft = icon(
  <><path d="M17 7L7 17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  <path d="M17 17H7V7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/></>
);

export const IconShield = icon(
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
);

export const IconSun = icon(
  <><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/></>
);

export const IconMoon = icon(
  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
);

export const IconNetwork = icon(
  <><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75"/>
  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1.75"/></>
);
