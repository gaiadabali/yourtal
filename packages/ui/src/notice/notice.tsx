import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../cn";

export const noticeVariants = cva("flex flex-col gap-2 rounded-card p-4 text-body-sm font-sans", {
  variants: {
    tone: {
      info: "bg-info-subtle text-info-on-subtle",
      success: "bg-success-subtle text-success-on-subtle",
      warning: "bg-warning-subtle text-warning-on-subtle",
      danger: "bg-danger-subtle text-danger-on-subtle",
    },
  },
  defaultVariants: { tone: "info" },
});

export interface NoticeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof noticeVariants> {
  title?: React.ReactNode;
  action?: React.ReactNode;
}

/** A subtle inline banner. info/success are ambient (role="status"); warning/danger interrupt (role="alert"). */
export const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(
  ({ tone = "info", title, action, className, children, ...props }, ref) => (
    <div
      ref={ref}
      role={tone === "warning" || tone === "danger" ? "alert" : "status"}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  ),
);
Notice.displayName = "Notice";
