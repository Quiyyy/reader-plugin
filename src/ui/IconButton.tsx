import type React from 'react';
export function IconButton({ label, active, children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}>{children}</button>;
}
