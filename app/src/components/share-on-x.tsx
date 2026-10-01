import { absoluteUrl, xIntentUrl } from "@/lib/share";

/** Opens X's composer with `text` + the absolute URL of `path` (which unfurls as a card). */
export function ShareOnX({
  text,
  path,
  label = "Share on X",
  className = "",
}: {
  text: string;
  path: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={xIntentUrl(text, absoluteUrl(path))}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "text-[11px] text-muted hover:text-text-hi transition-all duration-[120ms] font-mono",
        className,
      ].join(" ")}
    >
      {label} ↗
    </a>
  );
}
