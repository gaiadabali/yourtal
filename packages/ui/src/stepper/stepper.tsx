import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../cn";

export interface StepperStep {
  key: string;
  label: string;
}

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLOListElement>, "children"> {
  steps: StepperStep[];
  /** Index of the step in progress now. Steps before it are complete, after it are upcoming. */
  currentIndex: number;
}

/** A horizontal progress stepper. The current step carries aria-current="step". */
export const Stepper = React.forwardRef<HTMLOListElement, StepperProps>(
  ({ steps, currentIndex, className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex w-full items-start", className)} {...props}>
      {steps.map((step, index) => {
        const status =
          index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
        return (
          <li
            key={step.key}
            aria-current={status === "current" ? "step" : undefined}
            className="flex flex-1 flex-col items-center gap-2 last:flex-none"
          >
            <div className="flex w-full items-center">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-pill text-body-sm font-sans font-semibold",
                  status === "complete" && "bg-accent text-fg-on-accent",
                  status === "current" && "border-2 border-accent text-accent",
                  status === "upcoming" && "border border-border-subtle text-fg-subtle",
                )}
              >
                {status === "complete" ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-px flex-1",
                    status === "complete" ? "bg-accent" : "bg-border-subtle",
                  )}
                />
              ) : null}
            </div>
            <span
              className={cn(
                "text-caption font-sans",
                status === "upcoming" ? "text-fg-subtle" : "text-fg",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  ),
);
Stepper.displayName = "Stepper";
