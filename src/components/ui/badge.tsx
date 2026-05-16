import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.18em] transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/[0.06] text-primary hover:bg-primary/[0.1]",
        secondary:
          "border-white/10 bg-white/[0.03] text-secondary-foreground hover:bg-white/[0.05]",
        destructive:
          "border-destructive/25 bg-destructive/[0.06] text-destructive hover:bg-destructive/[0.1]",
        outline: "border-white/10 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
