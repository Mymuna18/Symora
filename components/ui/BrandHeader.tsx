export function BrandHeader() {
  return (
    <header className="relative flex items-center gap-3 overflow-hidden bg-forest-950 px-6 py-2 text-white">
      <span aria-hidden="true" className="pointer-events-none absolute left-[25%] bottom-1 text-xs text-glow/40">✦</span>
      <span aria-hidden="true" className="pointer-events-none absolute left-[38%] top-2 text-glow/60">✦</span>
      <span aria-hidden="true" className="pointer-events-none absolute left-[55%] bottom-1 text-sm text-glow/40">✦</span>
      <span aria-hidden="true" className="pointer-events-none absolute left-[70%] top-3 text-xs text-mint/50">•</span>
      <span aria-hidden="true" className="pointer-events-none absolute left-[85%] bottom-2 text-glow/50">✦</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/symora-emblem.svg" alt="" className="h-9 w-9" />
      <span className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold leading-none tracking-wide">
        Symora
      </span>
    </header>
  );
}