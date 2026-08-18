import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]",
  {
    variants: {
      variant: {
        primary: "bg-[var(--color-accent)] text-white hover:bg-[#194e80]",
        secondary: "border border-[var(--color-kant)] bg-white text-[var(--color-tekst)] hover:bg-[var(--color-flade)]",
        ghost: "text-[var(--color-daempet)] hover:bg-[var(--color-flade)]",
        fare: "border border-[var(--color-roed)] bg-white text-[var(--color-roed)] hover:bg-[var(--color-roed-svag)]",
        medhold: "border border-[var(--color-groen)] bg-white text-[var(--color-groen)] hover:bg-[var(--color-groen-svag)]",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
