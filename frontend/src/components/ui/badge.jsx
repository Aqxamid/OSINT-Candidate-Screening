import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = {
  default: 'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
  secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
  destructive: 'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
  outline: 'text-foreground border-border',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-medium',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400 font-medium',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-400 font-medium',
  cached: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 font-medium',
  purple: 'border-purple-500/30 bg-purple-500/10 text-purple-400 font-medium',
};

function Badge({ className, variant = 'default', ...props }) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
