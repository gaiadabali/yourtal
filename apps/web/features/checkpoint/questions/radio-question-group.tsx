"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@yourtal/ui/cn";

export interface RadioQuestionOption {
  id: string;
  label: string;
}

export interface RadioQuestionGroupProps {
  options: RadioQuestionOption[];
  value: string | undefined;
  onValueChange: (value: string) => void;
  ariaLabelledBy: string;
  name: string;
  disabled?: boolean;
}

/**
 * Shared accessible radio-group primitive backing multiple_choice,
 * true_false and likert question views. Radix's RadioGroup implements the
 * WAI-ARIA radiogroup pattern itself — `role="radiogroup"`/`"radio"` and
 * roving-tabindex arrow-key navigation come for free (verified in
 * radio-question-group.test.tsx); this wrapper only adds the visual shell
 * and the option-to-label wiring. There is no radio-group primitive in
 * `packages/ui` yet (YT-0401's list did not include one), so this lives
 * locally per this ticket's brief rather than being added there.
 */
export function RadioQuestionGroup({ options, value, onValueChange, ariaLabelledBy, name, disabled = false }: RadioQuestionGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      value={value ?? null}
      onValueChange={onValueChange}
      aria-labelledby={ariaLabelledBy}
      name={name}
      disabled={disabled}
      className="flex flex-col gap-2"
    >
      {options.map((option) => {
        const inputId = `${name}-${option.id}`;
        const isChecked = value === option.id;
        return (
          <div
            key={option.id}
            className={cn(
              "flex items-center gap-3 rounded-md border border-border bg-surface p-3",
              isChecked && "border-primary bg-surface-raised",
            )}
          >
            <RadioGroupPrimitive.Item
              id={inputId}
              value={option.id}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "data-[state=checked]:border-primary",
              )}
            >
              <RadioGroupPrimitive.Indicator className="h-2.5 w-2.5 rounded-full bg-primary" />
            </RadioGroupPrimitive.Item>
            <LabelPrimitive.Root htmlFor={inputId} className="text-sm font-sans text-fg">
              {option.label}
            </LabelPrimitive.Root>
          </div>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
