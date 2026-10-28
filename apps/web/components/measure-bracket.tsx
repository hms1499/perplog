import type { ReactNode } from "react";

/**
 * PerpLog's signature (spec §1): two values stacked with their digits aligned, and a cyan bracket on their right
 * measuring the gap between them, labeled with what the gap is.
 */
export function MeasureBracket({
  top,
  bottom,
  label,
  size = "lg",
}: {
  top: ReactNode;
  bottom: ReactNode;
  label: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <div className="grid grid-cols-[auto_14px_minmax(0,1fr)] items-center gap-x-3">
      <div className="col-start-1 row-start-1">{top}</div>
      <div className={size === "lg" ? "col-start-1 row-start-2 mt-4" : "col-start-1 row-start-2 mt-2"}>
        {bottom}
      </div>
      <div
        aria-hidden="true"
        className="col-start-2 row-span-2 row-start-1 my-[1.1em] self-stretch border-brand border-y-[1.5px] border-r-[1.5px]"
      />
      <div
        className={
          size === "lg"
            ? "col-start-3 row-span-2 row-start-1 max-w-[16ch] font-medium text-[15px] text-brand leading-snug"
            : "col-start-3 row-span-2 row-start-1 max-w-[14ch] font-medium text-brand text-sm leading-snug"
        }
      >
        {label}
      </div>
    </div>
  );
}
