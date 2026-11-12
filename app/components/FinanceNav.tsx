import Link from "next/link";

const links = [
  ["Transactions", "/transactions"],
  ["Accounts", "/accounts"],
  ["Paychecks", "/paychecks"],
  ["Debt", "/debt"],
  ["Investments", "/investments"],
  ["Goals", "/goals"],
  ["Reports", "/reports"],
] as const;

export default function FinanceNav({ active }: { active: string }) {
  return (
    <nav aria-label="Primary" className="finance-nav flex min-w-max gap-1 sm:min-w-0 sm:flex-wrap">
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          aria-current={label === active ? "page" : undefined}
          className={`finance-nav-link rounded-full px-3 py-2 text-sm font-medium ${label === active ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
