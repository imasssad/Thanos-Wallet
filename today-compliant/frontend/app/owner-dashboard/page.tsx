"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { api, getToken, type OwnerDocument } from "@/lib/api";

const DOCUMENT_TYPES = [
  "Permit",
  "Contract",
  "Inspection report",
  "Safety certificate",
  "License",
  "Other",
];

const POLICY_TYPES = [
  "General liability",
  "Workers’ compensation",
  "Builder’s risk",
  "Commercial auto",
  "Umbrella / excess liability",
  "Other",
];

function formatDate(value: string | null) {
  if (!value) return "Not provided";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileField() {
  return (
    <div>
      <label className="block text-sm font-semibold text-ink">Document file *</label>
      <input
        name="file"
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        required
        className="mt-1 block w-full rounded-sm border border-dashed border-brown/40 bg-cream/40 px-3 py-5 text-sm file:mr-4 file:rounded-sm file:border-0 file:bg-brown file:px-4 file:py-2 file:font-semibold file:text-paper hover:file:bg-brown/90"
      />
      <p className="mt-1 text-xs text-ink/55">PDF, JPG, PNG, or WebP · Maximum 10 MB</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-ink">
      {label}
      {children}
    </label>
  );
}

const inputClass = "mt-1 w-full rounded-sm border border-brown/30 bg-paper px-3 py-2.5 font-normal text-ink outline-none focus:border-blue focus:ring-2 focus:ring-blue/20";

export default function OwnerDashboard() {
  const router = useRouter();
  const [documents, setDocuments] = useState<OwnerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"documentation" | "insurance" | null>(null);
  const [fileAction, setFileAction] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    try {
      setError(null);
      setDocuments(await api.listOwnerDocuments());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t load your documents");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const documentation = useMemo(
    () => documents.filter((document) => document.category === "documentation"),
    [documents],
  );
  const insurance = useMemo(
    () => documents.filter((document) => document.category === "insurance"),
    [documents],
  );

  async function submitForm(event: React.FormEvent<HTMLFormElement>, category: "documentation" | "insurance") {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError(null);
    setSuccess(null);
    setSubmitting(category);
    try {
      const form = new FormData(formElement);
      const saved = category === "documentation"
        ? await api.addDocumentation(form)
        : await api.addInsurancePolicy(form);
      setDocuments((current) => [saved, ...current]);
      formElement.reset();
      setSuccess(category === "insurance" ? "Insurance policy saved." : "Documentation saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be saved");
    } finally {
      setSubmitting(null);
    }
  }

  async function openFile(document: OwnerDocument, download: boolean) {
    setError(null);
    setFileAction(document.id + (download ? "-download" : "-view"));
    const previewWindow = !download ? window.open("", "_blank") : null;
    try {
      const blob = await api.getOwnerDocumentFile(document.id, download);
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const link = window.document.createElement("a");
        link.href = objectUrl;
        link.download = document.original_filename;
        link.click();
      } else if (previewWindow) {
        previewWindow.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank");
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (caught) {
      previewWindow?.close();
      setError(caught instanceof Error ? caught.message : "The file could not be opened");
    } finally {
      setFileAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-cream">
      <Header />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue">Project owner portal</p>
            <h1 className="mt-1 font-display text-4xl font-bold text-ink">Documents & insurance</h1>
            <p className="mt-2 max-w-2xl text-ink/65">
              Keep project records and insurance policies organized in one private place.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="min-w-28 rounded-sm border border-brown/20 bg-paper px-4 py-3">
              <p className="text-2xl font-semibold text-ink">{documentation.length}</p>
              <p className="text-xs text-ink/55">Documents</p>
            </div>
            <div className="min-w-28 rounded-sm border border-brown/20 bg-paper px-4 py-3">
              <p className="text-2xl font-semibold text-ink">{insurance.length}</p>
              <p className="text-xs text-ink/55">Policies</p>
            </div>
          </div>
        </div>

        {error && <div role="alert" className="mt-6 rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        {success && <div role="status" className="mt-6 rounded-sm border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{success}</div>}

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-sm border border-brown/20 bg-paper p-6 shadow-sm">
            <div className="border-b border-brown/15 pb-4">
              <h2 className="font-display text-2xl font-bold text-ink">Add documentation</h2>
              <p className="mt-1 text-sm text-ink/60">Permits, contracts, inspection reports, licenses, and certificates.</p>
            </div>
            <form onSubmit={(event) => submitForm(event, "documentation")} className="mt-5 space-y-4">
              <Field label="Document type *">
                <select name="document_type" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Select document type</option>
                  {DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="Document title *">
                <input name="title" required placeholder="e.g. Building permit – Phase 1" className={inputClass} />
              </Field>
              <Field label="Document date">
                <input name="document_date" type="date" className={inputClass} />
              </Field>
              <FileField />
              <button type="submit" disabled={submitting !== null} className="w-full rounded-sm bg-brown px-5 py-3 font-semibold text-paper hover:bg-brown/90 disabled:opacity-50">
                {submitting === "documentation" ? "Saving…" : "Save documentation"}
              </button>
            </form>
          </div>

          <div className="rounded-sm border border-blue/30 bg-paper p-6 shadow-sm">
            <div className="border-b border-blue/20 pb-4">
              <h2 className="font-display text-2xl font-bold text-ink">Add insurance policy</h2>
              <p className="mt-1 text-sm text-ink/60">Store policy details with the certificate or policy file.</p>
            </div>
            <form onSubmit={(event) => submitForm(event, "insurance")} className="mt-5 space-y-4">
              <Field label="Policy type *">
                <select name="policy_type" required defaultValue="" className={inputClass}>
                  <option value="" disabled>Select policy type</option>
                  {POLICY_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Insurance provider *"><input name="provider_name" required placeholder="Provider name" className={inputClass} /></Field>
                <Field label="Policy number *"><input name="policy_number" required placeholder="Policy number" className={inputClass} /></Field>
              </div>
              <Field label="Coverage amount ($)"><input name="coverage_amount" type="number" min="0" step="0.01" placeholder="1000000" className={inputClass} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Effective date *"><input name="effective_date" type="date" required className={inputClass} /></Field>
                <Field label="Expiration date *"><input name="expiration_date" type="date" required className={inputClass} /></Field>
              </div>
              <FileField />
              <button type="submit" disabled={submitting !== null} className="w-full rounded-sm bg-blue px-5 py-3 font-semibold text-paper hover:bg-blue/90 disabled:opacity-50">
                {submitting === "insurance" ? "Saving…" : "Save insurance policy"}
              </button>
            </form>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between border-b border-brown/25 pb-3">
            <div>
              <h2 className="font-display text-3xl font-bold text-ink">Saved files</h2>
              <p className="mt-1 text-sm text-ink/60">Open a file to read it, or download a copy.</p>
            </div>
            {!loading && <span className="text-sm text-ink/55">{documents.length} total</span>}
          </div>

          {loading ? (
            <p className="py-10 text-ink/60">Loading your documents…</p>
          ) : documents.length === 0 ? (
            <div className="mt-5 rounded-sm border border-dashed border-brown/30 bg-paper/70 px-6 py-12 text-center">
              <p className="font-semibold text-ink">No saved files yet</p>
              <p className="mt-1 text-sm text-ink/55">Use either form above to add your first document.</p>
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-sm border border-brown/20 bg-paper">
              <div className="hidden grid-cols-[1.4fr_1fr_1fr_auto] gap-4 border-b border-brown/15 bg-brown/5 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink/55 md:grid">
                <span>File</span><span>Type</span><span>Details</span><span>Actions</span>
              </div>
              {documents.map((document) => (
                <article key={document.id} className="grid gap-3 border-b border-brown/10 px-5 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center md:gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{document.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink/50">{document.original_filename} · {formatFileSize(document.file_size)}</p>
                  </div>
                  <div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${document.category === "insurance" ? "bg-blue/10 text-blue" : "bg-brown/10 text-brown"}`}>
                      {document.document_type}
                    </span>
                  </div>
                  <div className="text-sm text-ink/65">
                    {document.category === "insurance" ? (
                      <><p>{document.provider_name}</p><p className="text-xs">Expires {formatDate(document.expiration_date)}</p></>
                    ) : <p>{formatDate(document.document_date || document.created_at)}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openFile(document, false)} disabled={fileAction !== null} className="rounded-sm border border-blue px-3 py-1.5 text-sm font-semibold text-blue hover:bg-blue hover:text-paper disabled:opacity-50">
                      {fileAction === `${document.id}-view` ? "Opening…" : "View"}
                    </button>
                    <button onClick={() => openFile(document, true)} disabled={fileAction !== null} className="rounded-sm border border-brown/35 px-3 py-1.5 text-sm font-semibold text-brown hover:bg-brown hover:text-paper disabled:opacity-50">
                      {fileAction === `${document.id}-download` ? "Saving…" : "Download"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
