/**
 * Landing page.
 *
 * Server component, no client JS: this is the first thing anyone sees, and a page that ships a
 * framework runtime to render static text is a bad first impression.
 *
 * The chrome carries Zavron's identity (m1-identity design decision 8) — orange #ff4d12 on #0d0d0d.
 * Brand palettes belong to content surfaces, not to the product's own face.
 */
import Link from "next/link";

const PLATFORMS = ["Instagram", "Threads", "X", "TikTok"];

const PILLARS = [
  {
    label: "01",
    title: "One queue, every brand",
    body: "Zavron, personal, the next client — each with its own voice, colours and accounts. Switch brand and the board, the palette and the caption rules follow. No second login, no duplicated spreadsheet.",
  },
  {
    label: "02",
    title: "The gate stays human",
    body: "Approval is bound to the content, not to a row. Edit a caption after signing off and the approval voids itself. Nothing leaves this building because a cron job felt like it.",
  },
  {
    label: "03",
    title: "Proof, not promises",
    body: "Every attempt is recorded with the platform's own post id and its raw response. When a platform says it worked and the post is not there, the response is the only evidence that settles it.",
  },
];

const STEPS = [
  {
    n: "1",
    t: "Draft",
    d: "Write once, then tailor per platform — caption limits and hashtag rules differ, and the app knows which is which.",
  },
  {
    n: "2",
    t: "Check",
    d: "Each variant is measured against that platform's spec before you look at it, so the warning arrives before the mistake.",
  },
  {
    n: "3",
    t: "Approve",
    d: "One click, bound to a content hash. Change anything afterwards and the post returns to review.",
  },
  {
    n: "4",
    t: "Ship",
    d: "Queued, claimed, published, verified. If a platform refuses, you get the reason — not a spinner.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-zavron-line/70 bg-zavron-bg0/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold tracking-tight text-zavron-ink">
              Postvyn<span className="text-zavron-accent">.</span>
            </span>
            <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted sm:inline">
              by Zavron
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/health" className="text-zavron-muted transition-colors hover:text-zavron-ink">
              Status
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg bg-zavron-accent px-4 py-2 font-medium text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zavron-accent">
            The queue between your content and your platforms
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-zavron-ink sm:text-6xl">
            Several brands.
            <br />
            One board.
            <br />
            <span className="text-zavron-muted">Nothing ships until you say so.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-zavron-muted">
            Postvyn holds every queue you run — the studio&apos;s, your own, the client&apos;s — in one
            place, measures each post against the platform it is going to, and publishes only what you
            approved. Built for one operator with more brands than spare hours.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className="rounded-lg bg-zavron-accent px-5 py-3 text-sm font-semibold text-[#0d0d0d] transition-colors hover:bg-zavron-accent-soft"
            >
              Sign in
            </Link>
            <Link
              href="/health"
              className="rounded-lg border border-zavron-line px-5 py-3 text-sm font-medium text-zavron-ink transition-colors hover:border-zavron-muted"
            >
              See live status
            </Link>
            <Link
              href="/register"
              className="px-2 py-3 text-sm text-zavron-muted transition-colors hover:text-zavron-ink"
            >
              Create an account
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zavron-line/60 pt-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
              Ships to
            </span>
            {PLATFORMS.map((platform) => (
              <span key={platform} className="text-sm text-zavron-ink/80">
                {platform}
              </span>
            ))}
            <span className="text-xs text-zavron-muted">
              TikTok by hand, always — their terms, not ours.
            </span>
          </div>
        </section>

        <section className="border-y border-zavron-line/60 bg-zavron-bg1/40">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3 sm:gap-px sm:divide-x sm:divide-zavron-line/60">
            {PILLARS.map((pillar) => (
              <article key={pillar.label} className="sm:px-6 sm:first:pl-0 sm:last:pr-0">
                <span className="font-mono text-[11px] tracking-[0.2em] text-zavron-accent">
                  {pillar.label}
                </span>
                <h2 className="mt-3 text-lg font-semibold text-zavron-ink">{pillar.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-zavron-muted">{pillar.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zavron-muted">
            How a post travels
          </h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <li key={step.n} className="rounded-xl border border-zavron-line/70 p-5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-zavron-accent">{step.n}</span>
                  <h3 className="text-sm font-semibold text-zavron-ink">{step.t}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zavron-muted">{step.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <div className="rounded-xl border border-zavron-line bg-zavron-bg1/50 p-6 sm:p-8">
            <h2 className="text-sm font-semibold text-zavron-ink">What this does not do</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zavron-muted">
              It will not upload to TikTok — their guidelines refuse utility uploads to accounts you
              manage, and a ban is a worse outcome than a manual step. It will not post to X for free:
              X charges per post now, so X stays a manual copy-paste until that cost is worth paying. It
              will not publish anything you have not approved, and it will not pretend a post succeeded
              when the platform never answered.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-zavron-line/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zavron-muted">
            <span className="text-zavron-ink">Postvyn</span> is built by{" "}
            <a
              href="https://zavrondev.com"
              className="text-zavron-ink underline decoration-zavron-line underline-offset-4 hover:decoration-zavron-accent"
            >
              Zavron
            </a>
            {" — "}we build what your business runs on.
          </p>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/health" className="text-zavron-muted hover:text-zavron-ink">
              Status
            </Link>
            <Link href="/sign-in" className="text-zavron-muted hover:text-zavron-ink">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
