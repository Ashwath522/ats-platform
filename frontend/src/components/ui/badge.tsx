import React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
}

export function Badge({
  className = '',
  variant = 'default',
  children,
  ...props
}: BadgeProps) {
  let baseStyles = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider '

  if (variant === 'secondary') {
    baseStyles += 'bg-slate-800 text-slate-300 '
  } else if (variant === 'outline') {
    baseStyles += 'border border-slate-700 text-slate-300 '
  } else if (variant === 'destructive') {
    baseStyles += 'bg-red-500/10 text-red-400 border border-red-500/30 '
  } else {
    baseStyles += 'bg-blue-500/10 text-blue-400 border border-blue-500/20 '
  }

  return (
    <span className={`${baseStyles} ${className}`} {...props}>
      {children}
    </span>
  )
}
