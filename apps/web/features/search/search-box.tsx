import { Input } from "@yourtal/ui/input";
import { Button } from "@yourtal/ui/button";

export interface SearchBoxProps {
  query: string;
  label: string;
  placeholder: string;
  submitLabel: string;
}

/** A plain GET form, so it works before hydration; the header's icon lands here below md. */
export function SearchBox({ query, label, placeholder, submitLabel }: SearchBoxProps) {
  return (
    <form action="/search" method="get" role="search" className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input
          type="search"
          name="q"
          label={label}
          hideLabel
          placeholder={placeholder}
          defaultValue={query}
          autoFocus={query === ""}
        />
      </div>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}
