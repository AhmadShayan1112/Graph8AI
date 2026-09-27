import { type FC } from 'react'

// The Gapwise mark: a G drawn as a ring with a gap, and the block that fills it.
export const LogoMark: FC<{ size?: number; className?: string }> = ({ size = 24, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
    <rect width="32" height="32" rx="8" fill="#2C5DBD" />
    <path
      d="M18.07 8.79A7.5 7.5 0 1 0 23.46 15.22M23.4 16H16.4"
      fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
    />
    <rect x="19.95" y="9.35" width="3.9" height="3.9" rx="1" fill="#A8C5F9" />
  </svg>
)
