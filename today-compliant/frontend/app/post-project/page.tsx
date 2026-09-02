"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { api } from "@/lib/api";

const JOB_TYPES = ["Plumbing", "Electrical", "Carpentry", "Roofing", "HVAC", "Painting", "Landscaping"];

export default function PostProject() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    budget_min: "",
    budget_max: "",
    city: "",
    state: "",
    job_type: JOB_TYPES[0],
    union_status: "na",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await api.createProject({
        title: form.title,
        description: form.description || undefined,
        budget_min: form.budget_min ? form.budget_min : undefined,
        budget_max: form.budget_max ? form.budget_max : undefined,
        city: form.city,
        state: form.state,
        job_type: form.job_type,
        union_status: form.union_status as "union" | "non_union" | "na",
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post the project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-cream">
      <Header />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-ink">Post a project</h1>
        <p className="mt-1 text-ink/70">
          Only your city and state are shown publicly — never your exact address.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink">Project title</label>
            <input
              required
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Bathroom renovation"
              className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink placeholder:text-ink/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink">Budget min ($)</label>
              <input
                type="number"
                value={form.budget_min}
                onChange={(e) => update("budget_min", e.target.value)}
                className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">Budget max ($)</label>
              <input
                type="number"
                value={form.budget_max}
                onChange={(e) => update("budget_max", e.target.value)}
                className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink">City</label>
              <input
                required
                value={form.city}
                onChange={(e) => update("city", e.target.value)}
                className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink">State</label>
              <input
                required
                value={form.state}
                onChange={(e) => update("state", e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="IL"
                className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink placeholder:text-ink/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Trade</label>
            <select
              value={form.job_type}
              onChange={(e) => update("job_type", e.target.value)}
              className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
            >
              {JOB_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink">Union status</label>
            <select
              value={form.union_status}
              onChange={(e) => update("union_status", e.target.value)}
              className="mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2 text-ink"
            >
              <option value="union">Union</option>
              <option value="non_union">Non-union</option>
              <option value="na">Not applicable</option>
            </select>
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-sm bg-blue py-2.5 font-semibold text-paper hover:bg-blue/90 disabled:opacity-50"
          >
            {submitting ? "Posting…" : "Post project"}
          </button>
        </form>
      </div>
    </main>
  );
}
