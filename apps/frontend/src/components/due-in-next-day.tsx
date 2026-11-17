/**
 * What the next 24 hours will attempt to publish.
 *
 * Read-only on purpose: the list exists so an operator can see a slot before it fires, not so a slot
 * can be moved from here. Times are rendered in the workspace's timezone — storage is unix-ms UTC, but
 * "09:00" only means something in a zone.
 */
import Link from "next/link";

import { formatInZone } from "@/lib/time";

export interface DueJob {
  id: string;
  state: string;
  runAfter: number;
  attempts: number;
  lastError: string | null;
  postId: string;
  postTitle: string;
  platform: string;
  brandName: string;
}

export function DueInNextDay({ jobs, timeZone }: { jobs: DueJob[]; timeZone: string }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between border-b border-zavron-line pb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zavron-muted">
          Due in the next 24 hours
        </h2>
        <span className="font-mono text-[10px] text-zavron-muted/70">{timeZone}</span>
      </div>

      {jobs.length === 0 ? (
        <p className="mt-3 text-sm text-zavron-muted">Nothing due in the next 24 hours.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-zavron-line bg-zavron-bg1/40 px-3 py-2"
            >
              <time dateTime={new Date(job.runAfter).toISOString()} className="font-mono text-[10px] text-zavron-muted">
                {formatInZone(job.runAfter, timeZone)}
              </time>
              <Link
                href={`/posts/${job.postId}`}
                className="text-sm text-zavron-ink transition-colors hover:text-brand-accent"
              >
                {job.postTitle}
              </Link>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-accent">
                {job.platform}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                {job.brandName}
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-zavron-muted">
                {job.state === "awaiting_platform" ? "waiting on platform" : "queued"}
                {job.attempts > 0 ? ` · attempt ${job.attempts}` : ""}
              </span>
              {job.lastError ? (
                <span className="w-full font-mono text-[10px] text-zavron-muted/70">{job.lastError}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
