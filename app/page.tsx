import Link from "next/link";
import { BrandHeader } from "@/components/ui/BrandHeader";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#d8e8dd] text-ink">
      <BrandHeader />
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-6xl flex-col justify-center px-5 py-12 sm:px-8">
        <section className="grid items-center gap-10 rounded-[2rem] border border-forest-800/10 bg-cream px-6 py-10 shadow-sm sm:px-12 sm:py-14 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-leaf">
              Multilingual symptom reporting
            </p>
            <h1 className="mt-4 max-w-2xl font-[family-name:var(--font-fraunces)] text-4xl font-semibold leading-tight text-forest-950 sm:text-6xl">
              A clearer way to share how you feel.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
              Symora helps clinical study participants report symptoms and gives study teams a simple review workflow.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="inline-flex min-h-14 items-center justify-center rounded-full bg-forest-800 px-8 py-3 text-lg font-semibold text-white shadow-sm transition hover:bg-leaf"
              >
                Try Demo
              </Link>
              <Link
                href="/participant-login"
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-forest-800/30 bg-white/70 px-7 py-3 font-semibold text-forest-900 transition hover:bg-white"
              >
                Participant Sign In
              </Link>
              <Link
                href="/coordinator-login"
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-forest-800/30 bg-white/70 px-7 py-3 font-semibold text-forest-900 transition hover:bg-white"
              >
                Coordinator Sign In
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted">
              The public demo uses fictional information stored only in your browser. Do not enter real health information.
            </p>
          </div>

          <div aria-hidden="true" className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-full bg-[#c3dccd]">
            <div className="absolute inset-5 rounded-full border border-forest-800/15" />
            <div className="absolute inset-12 rounded-full border border-forest-800/15" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/symora-emblem.svg" alt="" className="h-36 w-36 sm:h-44 sm:w-44" />
            <span className="absolute right-10 top-10 text-3xl text-glow">✦</span>
            <span className="absolute bottom-12 left-9 text-xl text-leaf">✦</span>
          </div>
        </section>
        <p className="mt-6 text-center text-xs text-muted">
          HackRU demonstration · Not a medical device or a substitute for care from your study team.
        </p>
      </main>
    </div>
  );
}
