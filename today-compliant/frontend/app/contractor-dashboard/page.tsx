"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  clearToken,
  getToken,
  type ComplianceTask,
  type ContractorPhoto,
  type ContractorProfile,
  type ContractorProject,
  type ContractorType,
  type OwnerDocument,
} from "@/lib/api";

type Section = "profile" | "projects" | "documents" | "insurance" | "tasks" | "photos" | "types";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "projects", label: "Projects" },
  { id: "documents", label: "Documents" },
  { id: "insurance", label: "Insurance Policies" },
  { id: "tasks", label: "Compliance Tasks" },
  { id: "photos", label: "Branded Equipment Photos" },
  { id: "types", label: "Contractor Types" },
];

const DOCUMENT_TYPES = ["Business license", "Trade license", "W-9", "Safety certificate", "Certification", "Other"];
const POLICY_TYPES = ["General liability", "Workers’ compensation", "Commercial auto", "Umbrella / excess liability", "Other"];
const CONTRACTOR_TYPES = ["General contractor", "Electrical", "Plumbing", "HVAC", "Roofing", "Carpentry", "Painting", "Landscaping", "Concrete / masonry"];

const inputClass = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2.5 font-normal text-slate-900 outline-none focus:border-blue focus:ring-2 focus:ring-blue/20";

function MenuIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-5 w-5 ${active ? "text-white" : "text-slate-600"}`} fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}{children}</label>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function formatMoney(value: string | null) {
  if (!value) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
}

export default function ContractorDashboard() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("profile");
  const [profile, setProfile] = useState<ContractorProfile | null>(null);
  const [profileForm, setProfileForm] = useState<Partial<ContractorProfile>>({});
  const [projects, setProjects] = useState<ContractorProject[]>([]);
  const [documents, setDocuments] = useState<OwnerDocument[]>([]);
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [photos, setPhotos] = useState<ContractorPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<ContractorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newType, setNewType] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profileData, projectData, documentData, taskData, photoData, typeData] = await Promise.all([
        api.getContractorProfile(),
        api.listContractorProjects(),
        api.listContractorDocuments(),
        api.listComplianceTasks(),
        api.listContractorPhotos(),
        api.listContractorTypes(),
      ]);
      setProfile(profileData);
      setProfileForm(profileData);
      setProjects(projectData);
      setDocuments(documentData);
      setTasks(taskData);
      setPhotos(photoData);
      setTypes(typeData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t load contractor compliance data");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    Promise.all(photos.map(async (photo) => {
      const blob = await api.getContractorPhotoFile(photo.id);
      urls[photo.id] = URL.createObjectURL(blob);
    })).then(() => { if (!cancelled) setPhotoUrls(urls); }).catch(() => undefined);
    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photos]);

  const generalDocuments = useMemo(() => documents.filter((item) => item.category === "documentation"), [documents]);
  const policies = useMemo(() => documents.filter((item) => item.category === "insurance"), [documents]);
  const completeTasks = tasks.filter((task) => task.status === "complete").length;
  const completion = tasks.length ? Math.round((completeTasks / tasks.length) * 100) : 0;

  async function refreshTasks() {
    setTasks(await api.listComplianceTasks());
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy("profile"); setError(null); setSuccess(null);
    try {
      const saved = await api.updateContractorProfile(profileForm);
      setProfile(saved); setProfileForm(saved); setEditing(false);
      await refreshTasks();
      setSuccess("Profile updated successfully.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Profile could not be updated");
    } finally { setBusy(null); }
  }

  async function submitDocument(event: React.FormEvent<HTMLFormElement>, category: "documentation" | "insurance") {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(category); setError(null); setSuccess(null);
    try {
      const form = new FormData(formElement);
      const saved = category === "documentation" ? await api.addContractorDocumentation(form) : await api.addContractorInsurance(form);
      setDocuments((current) => [saved, ...current]);
      formElement.reset();
      await refreshTasks();
      setSuccess(category === "insurance" ? "Insurance policy saved." : "Compliance document saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "File could not be saved");
    } finally { setBusy(null); }
  }

  async function openDocument(document: OwnerDocument, download: boolean) {
    setBusy(document.id); setError(null);
    const preview = !download ? window.open("", "_blank") : null;
    try {
      const blob = await api.getContractorDocumentFile(document.id, download);
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = window.document.createElement("a"); link.href = url; link.download = document.original_filename; link.click();
      } else if (preview) preview.location.href = url;
      else window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      preview?.close(); setError(caught instanceof Error ? caught.message : "File could not be opened");
    } finally { setBusy(null); }
  }

  async function uploadPhoto(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy("photo"); setError(null); setSuccess(null);
    try {
      const saved = await api.addContractorPhoto(new FormData(formElement));
      setPhotos((current) => [saved, ...current]); formElement.reset();
      await refreshTasks(); setSuccess("Equipment photo uploaded.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Photo could not be uploaded"); }
    finally { setBusy(null); }
  }

  async function addType(event: React.FormEvent) {
    event.preventDefault();
    if (!newType) return;
    setBusy("type"); setError(null); setSuccess(null);
    try {
      const saved = await api.addContractorType(newType);
      setTypes((current) => [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setNewType(""); await refreshTasks(); setSuccess("Contractor type added.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Contractor type could not be added"); }
    finally { setBusy(null); }
  }

  async function removeType(id: string) {
    setBusy(id); setError(null);
    try { await api.deleteContractorType(id); setTypes((current) => current.filter((item) => item.id !== id)); await refreshTasks(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Contractor type could not be removed"); }
    finally { setBusy(null); }
  }

  const title = SECTIONS.find((item) => item.id === section)?.label || "Contractor Compliance";

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <aside className="border-b border-slate-200 bg-slate-50 lg:fixed lg:inset-y-0 lg:left-0 lg:w-80 lg:border-b-0 lg:border-r">
        <div className="flex h-24 items-center gap-4 border-b border-slate-200 px-7">
          <div className="font-display text-3xl font-bold leading-[0.7] text-brown">TO<br />DAY</div>
          <div><p className="text-lg font-semibold">Contractor Compliance</p><p className="text-xs text-slate-500">TODAY Compliant</p></div>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-4 lg:block lg:space-y-1 lg:p-6" aria-label="Contractor dashboard">
          {SECTIONS.map((item) => {
            const active = section === item.id;
            return (
              <button key={item.id} onClick={() => { setSection(item.id); setError(null); setSuccess(null); }} className={`flex shrink-0 items-center gap-3 rounded px-4 py-3 text-left text-sm font-medium lg:w-full lg:text-base ${active ? "bg-brown text-white" : "text-slate-700 hover:bg-slate-200"}`}>
                <MenuIcon active={active} /><span className="max-w-52 truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="hidden border-t border-slate-200 p-6 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <button onClick={() => { clearToken(); window.location.href = "/login"; }} className="w-full rounded border border-slate-300 bg-white px-4 py-2.5 font-medium hover:bg-slate-100">Log out</button>
        </div>
      </aside>

      <div className="lg:ml-80">
        <header className="flex min-h-20 items-center justify-between border-b border-slate-200 px-6 py-4 lg:px-8">
          <div className="text-sm text-slate-500"><span>Contractor Compliance</span><span className="mx-3">›</span><span className="text-slate-800">{title}</span></div>
          <button onClick={loadDashboard} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">Refresh</button>
        </header>

        <div className="px-6 py-7 lg:px-8">
          <div className="border-b border-slate-200 pb-6">
            <h1 className="font-display text-3xl font-bold">{title}</h1>
            <p className="mt-1 text-slate-500">Centralized repository of contractor details and compliance information.</p>
          </div>
          {error && <div role="alert" className="mt-5 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
          {success && <div role="status" className="mt-5 rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">{success}</div>}
          {loading ? <p className="py-12 text-slate-500">Loading contractor compliance…</p> : (
            <div className="py-7">
              {section === "profile" && profile && (
                <section>
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-3"><span className={`rounded-full px-3 py-1 text-sm font-semibold ${profile.compliance_status === "active" ? "bg-green-100 text-green-800" : "bg-sky-100 text-sky-800"}`}>{profile.compliance_status}</span><span className="text-sm text-slate-500">Onboarding {completion}% complete</span></div>
                    <button onClick={() => { setEditing(!editing); setProfileForm(profile); }} className="rounded border border-slate-300 px-5 py-2 font-semibold hover:bg-slate-50">{editing ? "Cancel" : "Edit profile"}</button>
                  </div>
                  {editing ? (
                    <form onSubmit={saveProfile} className="grid gap-5 rounded border border-slate-200 bg-slate-50 p-6 md:grid-cols-2 xl:grid-cols-3">
                      {([
                        ["company_name", "Company name"], ["dba_name", "DBA name"], ["primary_contact", "Primary contact"],
                        ["contact_email", "Contact email"], ["contact_phone", "Phone"], ["website", "Website"],
                        ["address", "Address"], ["county", "County"], ["city", "City"], ["state", "State"],
                        ["zip_code", "ZIP"], ["trade_category_l1", "Trade category"],
                      ] as [keyof ContractorProfile, string][]).map(([key, label]) => (
                        <Field key={key} label={label}><input value={String(profileForm[key] ?? "")} onChange={(e) => setProfileForm((current) => ({ ...current, [key]: e.target.value }))} className={inputClass} /></Field>
                      ))}
                      <Field label="Years in business"><input type="number" min="0" value={profileForm.years_in_business ?? ""} onChange={(e) => setProfileForm((current) => ({ ...current, years_in_business: e.target.value ? Number(e.target.value) : null }))} className={inputClass} /></Field>
                      <Field label="Employee count"><input type="number" min="0" value={profileForm.employee_count ?? ""} onChange={(e) => setProfileForm((current) => ({ ...current, employee_count: e.target.value ? Number(e.target.value) : null }))} className={inputClass} /></Field>
                      <label className="block text-sm font-semibold text-slate-700 md:col-span-2 xl:col-span-3">Company bio<textarea rows={4} value={profileForm.public_bio ?? ""} onChange={(e) => setProfileForm((current) => ({ ...current, public_bio: e.target.value }))} className={inputClass} /></label>
                      <button disabled={busy !== null} className="rounded bg-brown px-6 py-3 font-semibold text-white disabled:opacity-50 md:col-span-2 xl:col-span-3">{busy === "profile" ? "Saving…" : "Save profile"}</button>
                    </form>
                  ) : (
                    <div className="grid gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
                      {([
                        ["Company name", profile.company_name], ["DBA name", profile.dba_name], ["Primary contact", profile.primary_contact],
                        ["Username", profile.username], ["Email", profile.contact_email], ["Phone", profile.contact_phone],
                        ["Website", profile.website], ["County", profile.county], ["Address", profile.address], ["City", profile.city],
                        ["State", profile.state], ["ZIP", profile.zip_code], ["Trade category", profile.trade_category_l1],
                        ["Years in business", profile.years_in_business], ["Employee count", profile.employee_count],
                      ]).map(([label, value]) => <div key={String(label)}><p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-xl">{value ?? "—"}</p></div>)}
                    </div>
                  )}
                </section>
              )}

              {section === "projects" && (projects.length ? <div className="grid gap-4 md:grid-cols-2">{projects.map((item) => <article key={item.project.id} className="rounded border border-slate-200 p-5"><div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{item.project.title}</h2><span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">{item.bid_status}</span></div><p className="mt-2 text-sm text-slate-500">{item.project.city}, {item.project.state} · {item.project.job_type}</p><p className="mt-3 text-sm">Submitted {formatDate(item.submitted_at)}</p></article>)}</div> : <EmptyState title="No contractor projects yet" description="Projects appear here after you submit a bid." />)}

              {section === "documents" && (
                <section className="grid gap-7 xl:grid-cols-[380px_1fr]">
                  <form onSubmit={(e) => submitDocument(e, "documentation")} className="space-y-4 rounded border border-slate-200 bg-slate-50 p-5">
                    <h2 className="text-xl font-semibold">Add document</h2>
                    <Field label="Document type *"><select name="document_type" required defaultValue="" className={inputClass}><option value="" disabled>Select type</option>{DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
                    <Field label="Document title *"><input name="title" required className={inputClass} /></Field>
                    <Field label="Document date"><input name="document_date" type="date" className={inputClass} /></Field>
                    <Field label="File *"><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} text-sm`} /></Field>
                    <p className="text-xs text-slate-500">PDF or image · Maximum 10 MB</p>
                    <button disabled={busy !== null} className="w-full rounded bg-brown px-5 py-3 font-semibold text-white disabled:opacity-50">{busy === "documentation" ? "Saving…" : "Save document"}</button>
                  </form>
                  <DocumentList documents={generalDocuments} busy={busy} openDocument={openDocument} emptyTitle="No compliance documents" />
                </section>
              )}

              {section === "insurance" && (
                <section className="grid gap-7 xl:grid-cols-[400px_1fr]">
                  <form onSubmit={(e) => submitDocument(e, "insurance")} className="space-y-4 rounded border border-sky-200 bg-sky-50/40 p-5">
                    <h2 className="text-xl font-semibold">Add insurance policy</h2>
                    <Field label="Policy type *"><select name="policy_type" required defaultValue="" className={inputClass}><option value="" disabled>Select policy</option>{POLICY_TYPES.map((type) => <option key={type}>{type}</option>)}</select></Field>
                    <Field label="Provider *"><input name="provider_name" required className={inputClass} /></Field>
                    <Field label="Policy number *"><input name="policy_number" required className={inputClass} /></Field>
                    <Field label="Coverage amount ($)"><input name="coverage_amount" type="number" min="0" step="0.01" className={inputClass} /></Field>
                    <div className="grid grid-cols-2 gap-3"><Field label="Effective *"><input name="effective_date" type="date" required className={inputClass} /></Field><Field label="Expires *"><input name="expiration_date" type="date" required className={inputClass} /></Field></div>
                    <Field label="Policy file *"><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} text-sm`} /></Field>
                    <button disabled={busy !== null} className="w-full rounded bg-blue px-5 py-3 font-semibold text-white disabled:opacity-50">{busy === "insurance" ? "Saving…" : "Save policy"}</button>
                  </form>
                  <DocumentList documents={policies} busy={busy} openDocument={openDocument} emptyTitle="No insurance policies" insurance />
                </section>
              )}

              {section === "tasks" && (
                <section className="mx-auto max-w-4xl">
                  <div className="mb-6 rounded border border-slate-200 bg-slate-50 p-5"><div className="flex justify-between"><span className="font-semibold">Onboarding completion</span><span className="font-bold">{completion}%</span></div><div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue transition-all" style={{ width: `${completion}%` }} /></div></div>
                  <div className="space-y-3">{tasks.map((task) => <article key={task.id} className="flex items-start gap-4 rounded border border-slate-200 p-5"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${task.status === "complete" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{task.status === "complete" ? "✓" : "!"}</span><div><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-sm text-slate-500">{task.description}</p></div><span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${task.status === "complete" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{task.status}</span></article>)}</div>
                </section>
              )}

              {section === "photos" && (
                <section>
                  <form onSubmit={uploadPhoto} className="mb-7 grid items-end gap-4 rounded border border-slate-200 bg-slate-50 p-5 md:grid-cols-[1fr_1fr_auto]"><Field label="Photo *"><input name="file" type="file" required accept="image/jpeg,image/png,image/webp" className={`${inputClass} text-sm`} /></Field><Field label="Caption"><input name="caption" placeholder="e.g. Company service truck" className={inputClass} /></Field><button disabled={busy !== null} className="rounded bg-brown px-6 py-3 font-semibold text-white disabled:opacity-50">{busy === "photo" ? "Uploading…" : "Upload photo"}</button></form>
                  {photos.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{photos.map((photo) => <figure key={photo.id} className="overflow-hidden rounded border border-slate-200 bg-white"><div className="aspect-video bg-slate-100">{photoUrls[photo.id] ? <img src={photoUrls[photo.id]} alt={photo.caption || "Branded equipment"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading image…</div>}</div><figcaption className="p-4"><p className="font-semibold">{photo.caption || photo.original_filename}</p><p className="mt-1 text-xs text-slate-500">Uploaded {formatDate(photo.created_at)}</p></figcaption></figure>)}</div> : <EmptyState title="No equipment photos" description="Upload branded vehicles, machinery, uniforms, or job-site equipment." />}
                </section>
              )}

              {section === "types" && (
                <section className="mx-auto max-w-3xl">
                  <form onSubmit={addType} className="flex gap-3 rounded border border-slate-200 bg-slate-50 p-5"><select value={newType} onChange={(e) => setNewType(e.target.value)} required className={`${inputClass} mt-0`}><option value="">Select a contractor type</option>{CONTRACTOR_TYPES.map((type) => <option key={type}>{type}</option>)}</select><button disabled={busy !== null} className="rounded bg-brown px-6 font-semibold text-white disabled:opacity-50">Add</button></form>
                  <div className="mt-6 space-y-3">{types.map((type) => <div key={type.id} className="flex items-center justify-between rounded border border-slate-200 px-5 py-4"><span className="font-semibold">{type.name}</span><button onClick={() => removeType(type.id)} disabled={busy !== null} className="text-sm font-semibold text-red-700 hover:underline disabled:opacity-50">Remove</button></div>)}</div>
                  {!types.length && <div className="mt-6"><EmptyState title="No contractor types selected" description="Choose the classifications that best describe your services." /></div>}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function DocumentList({ documents, busy, openDocument, emptyTitle, insurance = false }: { documents: OwnerDocument[]; busy: string | null; openDocument: (document: OwnerDocument, download: boolean) => void; emptyTitle: string; insurance?: boolean }) {
  if (!documents.length) return <EmptyState title={emptyTitle} description="Use the form to add the first file." />;
  return (
    <div className="space-y-3">
      {documents.map((document) => (
        <article key={document.id} className="rounded border border-slate-200 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{document.title}</h2><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${insurance ? "bg-sky-100 text-sky-800" : "bg-stone-100 text-stone-700"}`}>{document.document_type}</span></div><p className="mt-1 truncate text-sm text-slate-500">{document.original_filename}</p>{insurance ? <p className="mt-2 text-sm text-slate-600">{document.provider_name} · {formatMoney(document.coverage_amount)} · Expires {formatDate(document.expiration_date)}</p> : <p className="mt-2 text-sm text-slate-600">Dated {formatDate(document.document_date)}</p>}</div>
            <div className="flex shrink-0 gap-2"><button onClick={() => openDocument(document, false)} disabled={busy !== null} className="rounded border border-blue px-3 py-2 text-sm font-semibold text-blue hover:bg-blue hover:text-white disabled:opacity-50">View</button><button onClick={() => openDocument(document, true)} disabled={busy !== null} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Download</button></div>
          </div>
        </article>
      ))}
    </div>
  );
}
