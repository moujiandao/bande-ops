import Link from 'next/link';

export function WorkflowSwitch({ current }: { current: 'replenishment' | 'reorder' }) {
  const itemClass = (active: boolean) =>
    `rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-accent bg-accent-soft text-accent-strong'
        : 'border-border bg-panel text-muted hover:text-foreground'
    }`;

  return (
    <nav aria-label="Inventory planning" className="flex gap-2 md:hidden">
      <Link href="/replenishment" className={itemClass(current === 'replenishment')}>
        FBA Replenishment
      </Link>
      <Link href="/reorder" className={itemClass(current === 'reorder')}>
        Supplier Reorder
      </Link>
    </nav>
  );
}
