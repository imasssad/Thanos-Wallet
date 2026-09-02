import Link from "next/link";
import type { Project } from "@/lib/api";

function formatBudget(min: string | null, max: string | null) {
  if (!min && !max) return null;
  const fmt = (v: string) => `$${Math.round(parseFloat(v)).toLocaleString()}`;
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  return fmt(min || max || "0");
}

function daysAgo(dateStr: string) {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days} days ago`;
}

const unionLabel: Record<Project["union_status"], string | null> = {
  union: "Union",
  non_union: "Non-Union",
  na: null,
};

export default function ProjectCard({ project }: { project: Project }) {
  const budget = formatBudget(project.budget_min, project.budget_max);
  const union = unionLabel[project.union_status];

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group block overflow-hidden rounded-sm border border-brown/20 bg-paper transition-shadow hover:shadow-lg"
    >
      <div className="h-1.5 bg-brown" />
      <div className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-sm bg-blue px-2 py-0.5 text-xs font-semibold text-paper">
            {project.job_type}
          </span>
          {union && (
            <span className="rounded-sm border border-brown/40 px-2 py-0.5 text-xs font-medium text-brown">
              {union}
            </span>
          )}
        </div>

        <h3 className="font-display text-xl font-bold text-ink group-hover:text-blue">
          {project.title}
        </h3>

        <p className="mt-1 flex items-center gap-1 text-sm text-ink/70">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <path
              d="M12 22s7-7.58 7-13a7 7 0 1 0-14 0c0 5.42 7 13 7 13Z"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" />
          </svg>
          {project.city}, {project.state}
        </p>

        <div className="mt-4 flex items-center justify-between border-t border-brown/10 pt-3">
          <span className="font-display text-lg font-semibold text-ink">
            {budget || "Budget on request"}
          </span>
          <span className="text-xs text-ink/50">{daysAgo(project.date_posted)}</span>
        </div>
      </div>
    </Link>
  );
}
