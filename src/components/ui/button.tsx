import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border text-sm font-medium tracking-[0.08em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary/40 bg-primary/90 text-primary-foreground shadow-[0_0_24px_rgba(45,212,191,0.12)] hover:bg-primary hover:shadow-[0_0_28px_rgba(45,212,191,0.18)]",
        destructive:
          "border-destructive/35 bg-destructive/90 text-destructive-foreground shadow-[0_0_18px_rgba(251,113,133,0.12)] hover:bg-destructive",
        outline:
          "border-white/10 bg-background/40 text-foreground hover:border-white/18 hover:bg-white/[0.04]",
        secondary:
          "border-white/8 bg-secondary text-secondary-foreground hover:border-white/16 hover:bg-secondary/90",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
