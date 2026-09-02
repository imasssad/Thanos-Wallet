"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import ProjectCard from "@/components/ProjectCard";
import { api, getToken, type Project } from "@/lib/api";

const JOB_TYPES = ["Plumbing", "Electrical", "Carpentry", "Roofing", "HVAC", "Painting", "Landscaping"];
const STATES = ["IL", "MO", "IN", "KY", "TN"]; // narrow starter list; expand as coverage grows

export default function LeadBoard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [jobType, setJobType] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [unionStatus, setUnionStatus] = useState("");

  const runSearch = useCallback(async () => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await api.listProjects({
        job_type: jobType,
        city,
        state,
        union_status: unionStatus,
      });
      setProjects(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong loading projects");
    } finally {
      setLoading(false);
    }
  }, [jobType, city, state, unionStatus, router]);

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-cream">
      <Header />

      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="font-display text-4xl font-bold text-ink">Open work near you</h1>
        <p className="mt-1 text-ink/70">Search by trade, location, and union status.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
          className="mt-6 flex flex-wrap gap-3 rounded-sm border border-brown/20 bg-paper p-4"
        >
          <select
            value={jobType}
            onChange={(e) => setJobType(e.target.value)}
            className="rounded-sm border border-brown/30 bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="">Any trade</option>
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-40 rounded-sm border border-brown/30 bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink/40"
          />

          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-sm border border-brown/30 bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="">Any state</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={unionStatus}
            onChange={(e) => setUnionStatus(e.target.value)}
            className="rounded-sm border border-brown/30 bg-paper px-3 py-2 text-sm text-ink"
          >
            <option value="">Union or non-union</option>
            <option value="union">Union</option>
            <option value="non_union">Non-union</option>
            <option value="na">Not applicable</option>
          </select>

          <button
            type="submit"
            className="ml-auto rounded-sm bg-blue px-6 py-2 text-sm font-semibold text-paper hover:bg-blue/90"
          >
            Search
          </button>
        </form>

        <div className="mt-8">
          {loading && <p className="text-ink/60">Loading open work…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {!loading && !error && projects.length === 0 && (
            <p className="text-ink/60">No projects match those filters yet. Try widening your search.</p>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
