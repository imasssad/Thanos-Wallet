"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "@/components/Header";
import { api, getToken, type Project } from "@/lib/api";

const unionLabel: Record<Project["union_status"], string> = {
  union: "Union",
  non_union: "Non-union",
  na: "Not applicable",
};

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api
      .getProject(params.id)
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this project"));
  }, [params.id, router]);

  return (
    <main className="min-h-screen bg-cream">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-12">
        {error && <p className="text-red-700">{error}</p>}

        {!error && !project && <p className="text-ink/60">Loading…</p>}

        {project && (
          <div className="overflow-hidden rounded-sm border border-brown/20 bg-paper">
            <div className="h-2 bg-brown" />
            <div className="p-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-sm bg-blue px-2 py-0.5 text-xs font-semibold text-paper">
                  {project.job_type}
                </span>
                <span className="rounded-sm border border-brown/40 px-2 py-0.5 text-xs font-medium text-brown">
                  {unionLabel[project.union_status]}
                </span>
              </div>

              <h1 className="font-display text-3xl font-bold text-ink">{project.title}</h1>
              <p className="mt-1 text-ink/70">
                {project.city}, {project.state}
              </p>

              {project.description && (
                <p className="mt-4 whitespace-pre-wrap text-ink/90">{project.description}</p>
              )}

              {(project.budget_min || project.budget_max) && (
                <p className="mt-4 font-display text-xl font-semibold text-ink">
                  Budget: ${project.budget_min} – ${project.budget_max}
                </p>
              )}

              <p className="mt-6 text-sm text-ink/50">
                Contact this client by phone or email through their posted contact details.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
