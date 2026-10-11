const bars = [
  { delay: 0, duration: 0.9 },
  { delay: 0.15, duration: 0.7 },
  { delay: 0.3, duration: 1.0 },
  { delay: 0.1, duration: 0.8 },
  { delay: 0.25, duration: 0.95 },
  { delay: 0.05, duration: 0.75 },
  { delay: 0.2, duration: 0.85 },
];

export function VoiceBars({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-16 items-center justify-center gap-2"
    >
      {bars.map((b, i) => (
        <span
          key={i}
          className="voice-bar h-full w-2.5 rounded-full bg-primary"
          style={
            active
              ? { animation: `voice-bar ${b.duration}s ease-in-out ${b.delay}s infinite` }
              : { transform: "scaleY(0.2)" }
          }
        />
      ))}
    </div>
  );
}