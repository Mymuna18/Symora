type Props = { listening: boolean; onClick: () => void; label: string };

// Bar heights in px. Left runs outer → inner, right runs inner → outer.
const left = [10, 20, 34, 26, 48, 64, 44, 28, 16];
const right = [16, 28, 44, 64, 48, 26, 34, 20, 10];

function Bar({ h, hue, i, active }: { h: number; hue: number; i: number; active: boolean }) {
  return (
    <span
      className="voice-bar w-1 rounded-full"
      style={{
        height: h,
        background: `hsl(${hue} 65% 48%)`,
        animation: active
          ? `voice-bar ${0.7 + (i % 4) * 0.12}s ease-in-out ${(i % 5) * 0.09}s infinite`
          : "none",
      }}
    />
  );
}

export function MicHero({ listening, onClick, label }: Props) {
  return (
    <div className="flex items-center justify-center gap-3">
      <div aria-hidden="true" className="flex items-center gap-1">
        {left.map((h, i) => (
          <Bar key={i} h={h} hue={36 + i * 16} i={i} active={listening} />
        ))}
      </div>

      <button
        type="button"
        onClick={onClick}
        aria-pressed={listening}
        aria-label={label}
        className={`flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-leaf to-forest-900 shadow-lg transition-all duration-300 ease-out hover:ring-4 hover:ring-glow/70 hover:shadow-[0_0_28px_rgba(240,180,90,0.45)] ${
          listening ? "ring-4 ring-glow" : "ring-2 ring-white/60"
        }`}
      >
        <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden="true">
          <rect x="24" y="6" width="16" height="30" rx="8" fill="#ffffff" />
          <path
            d="M16 28v4a16 16 0 0 0 32 0v-4"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path d="M32 48v8M23 56h18" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </button>

      <div aria-hidden="true" className="flex items-center gap-1">
        {right.map((h, i) => (
          <Bar key={i} h={h} hue={164 - i * 16} i={i + 3} active={listening} />
        ))}
      </div>
    </div>
  );
}