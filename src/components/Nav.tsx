"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/wire", label: "Wire" },
  { href: "/history", label: "History" },
  { href: "/shelf", label: "Shelf" },
  { href: "/system", label: "System" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-5 sm:gap-7 overflow-x-auto border-b border-rule py-2.5 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={`whitespace-nowrap transition-colors ${active ? "text-ink font-medium" : "text-muted hover:text-ink"}`}>
            {active && <span className="text-accent mr-1">●</span>}
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
