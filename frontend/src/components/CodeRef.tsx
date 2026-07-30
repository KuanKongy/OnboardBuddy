import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * One treatment for "this monospace thing is a code reference you can open".
 * The rule: primary tone = clickable, muted chip = a literal. The inert
 * `prose-code` chips generated prose produces stay muted — that contrast is why.
 */
export const codeRefClass = "font-mono text-primary underline-offset-2 hover:underline";

/**
 * A clickable code reference. Renders a router link for `to`, an anchor for
 * `href`, a button for `onClick` — whichever the call site needs, all three
 * carrying the same treatment.
 */
export function CodeRef({
  to,
  href,
  onClick,
  className,
  children,
  ...rest
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
  title?: string;
  "aria-label"?: string;
}) {
  const classes = cn(codeRefClass, className);

  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...rest}>
        {children}
      </a>
    );
  }
  return <button type="button" onClick={onClick} className={classes} {...rest}>{children}</button>;
}
