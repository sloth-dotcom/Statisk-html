import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-[var(--color-flade)] text-[var(--color-daempet)] border border-[var(--color-kant)]",
      accent: "bg-[var(--color-accent-svag)] text-[var(--color-accent)]",
      groen: "bg-[var(--color-groen-svag)] text-[var(--color-groen)]",
      gul: "bg-[var(--color-gul-svag)] text-[var(--color-gul)]",
      roed: "bg-[var(--color-roed-svag)] text-[var(--color-roed)]",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
