import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  pill?: boolean;
}

const variants: Record<Variant, string> = {
  // design.md button-primary: black on yellow, darker on press
  primary:
    'bg-primary text-on-primary hover:bg-primary-active active:bg-primary-active disabled:bg-primary-disabled disabled:text-muted',
  secondary:
    'bg-surface-2 text-strong border border-hairline hover:bg-surface-3 disabled:opacity-50',
  ghost: 'bg-transparent text-muted-strong hover:text-strong hover:bg-surface-2 disabled:opacity-50',
  danger: 'bg-down text-white hover:brightness-110 disabled:opacity-50',
  success: 'bg-up text-white hover:brightness-110 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-8 text-[15px] gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, pill, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-semibold leading-none whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        pill ? 'rounded-full' : 'rounded-md',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export function IconButton({
  className,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-9 items-center justify-center rounded-md text-muted-strong transition-colors hover:bg-surface-2 hover:text-strong',
        className,
      )}
      {...rest}
    />
  );
}
