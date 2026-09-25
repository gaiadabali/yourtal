import * as React from "react";
import { cn } from "../cn";

interface ListRowBaseProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}

export type ListRowProps =
  | (ListRowBaseProps & { href: string; onClick?: undefined } & Omit<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        "href" | "className" | "title" | "onClick"
      >)
  | (ListRowBaseProps & { onClick: () => void; href?: undefined } & Omit<
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        "onClick" | "className" | "title" | "href"
      >)
  | (ListRowBaseProps & { href?: undefined; onClick?: undefined });

const rowContentClassName = "flex min-h-control w-full items-center gap-3 px-3 py-2 text-start";
const interactiveClassName =
  "rounded-control hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function RowContent({ leading, title, subtitle, trailing }: ListRowBaseProps) {
  return (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-sans text-fg">{title}</span>
        {subtitle ? (
          <span className="truncate text-body-sm font-sans text-fg-muted">{subtitle}</span>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </>
  );
}

/**
 * A single row (avatar/icon, title, subtitle, trailing content) that is
 * either static, a link, or a button — whichever makes the whole row the
 * interactive target, at a 44 px minimum height.
 */
export function ListRow(props: ListRowProps) {
  const { leading, title, subtitle, trailing, className, href, onClick, ...rest } = props;
  const content = (
    <RowContent leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
  );

  if (href) {
    return (
      <a
        href={href}
        className={cn(rowContentClassName, interactiveClassName, className)}
        {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(rowContentClassName, interactiveClassName, className)}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(rowContentClassName, className)}
      {...(rest as React.HTMLAttributes<HTMLDivElement>)}
    >
      {content}
    </div>
  );
}
