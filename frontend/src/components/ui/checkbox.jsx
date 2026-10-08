import * as React from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const Checkbox = React.forwardRef(({ className, checked, onChange, disabled, ...props }, ref) => {
  return (
    <label className={cn('relative inline-flex items-center cursor-pointer select-none', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only peer"
        {...props}
      />
      <div
        className={cn(
          'h-4 w-4 shrink-0 rounded-sm border border-primary/50 shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors flex items-center justify-center',
          'peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:border-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
          className
        )}
      >
        {checked && <Check className="h-3 w-3 stroke-[3]" />}
      </div>
    </label>
  );
});
Checkbox.displayName = 'Checkbox';

export { Checkbox };
