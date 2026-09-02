import React from 'react'

export function Card({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`border-b border-slate-800 pb-4 mb-4 ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ className = '', children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-xl font-bold text-slate-100 ${className}`} {...props}>
      {children}
    </h3>
  )
}

export function CardDescription({ className = '', children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`text-xs text-slate-400 mt-1 ${className}`} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ className = '', children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`space-y-4 ${className}`} {...props}>
      {children}
    </div>
  )
}
