import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'default' | 'sm' | 'lg'
}

export function Button({
  className = '',
  variant = 'default',
  size = 'default',
  children,
  ...props
}: ButtonProps) {
  let baseStyles = 'inline-flex items-center justify-center font-semibold rounded-xl transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed '
  
  if (variant === 'outline') {
    baseStyles += 'border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-200 '
  } else if (variant === 'ghost') {
    baseStyles += 'bg-transparent hover:bg-slate-800 text-slate-300 '
  } else if (variant === 'destructive') {
    baseStyles += 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/20 '
  } else {
    baseStyles += 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 '
  }

  if (size === 'sm') {
    baseStyles += 'px-3 py-1.5 text-xs '
  } else if (size === 'lg') {
    baseStyles += 'px-6 py-3 text-base '
  } else {
    baseStyles += 'px-4 py-2 text-sm '
  }

  return (
    <button className={`${baseStyles} ${className}`} {...props}>
      {children}
    </button>
  )
}
