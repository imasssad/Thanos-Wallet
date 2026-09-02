const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function setToken(token: string) {
  localStorage.setItem("token", token);
}

export function clearToken() {
  localStorage.removeItem("token");
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (
    options.body &&
    !(options.body instanceof URLSearchParams) &&
    !(options.body instanceof FormData)
  ) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function requestBlob(path: string) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.blob();
}

export type Role = "client" | "contractor";

export interface Project {
  id: string;
  title: string;
  description: string | null;
  budget_min: string | null;
  budget_max: string | null;
  city: string;
  state: string;
  job_type: string;
  union_status: "union" | "non_union" | "na";
  status: string;
  date_posted: string;
}

export interface OwnerDocument {
  id: string;
  category: "documentation" | "insurance";
  document_type: string;
  title: string;
  provider_name: string | null;
  policy_number: string | null;
  coverage_amount: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  document_date: string | null;
  original_filename: string;
  content_type: string;
  file_size: number;
  created_at: string;
}

export interface ContractorProfile {
  id: string;
  username: string;
  company_name: string | null;
  dba_name: string | null;
  primary_contact: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
  county: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  years_in_business: number | null;
  employee_count: number | null;
  trade_category_l1: string | null;
  public_bio: string | null;
  compliance_status: "active" | "hold" | "pending";
}

export interface ComplianceTask {
  id: string;
  title: string;
  description: string;
  status: "complete" | "pending";
}

export interface ContractorPhoto {
  id: string;
  caption: string | null;
  original_filename: string;
  content_type: string;
  file_size: number;
  created_at: string;
}

export interface ContractorType {
  id: string;
  name: string;
  created_at: string;
}

export interface ContractorProject {
  project: Project;
  bid_status: "submitted" | "accepted" | "rejected" | "withdrawn";
  message: string | null;
  submitted_at: string;
}

export const api = {
  register: (data: { email: string; password: string; role: Role; company_name?: string }) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify(data) }),

  login: async (email: string, password: string) => {
    const form = new URLSearchParams();
    form.set("username", email);
    form.set("password", password);
    const result = await request("/api/auth/login", { method: "POST", body: form });
    setToken(result.access_token);
    return result;
  },

  me: () => request("/api/auth/me") as Promise<{ id: string; email: string; role: Role }>,

  listProjects: (filters: { job_type?: string; city?: string; state?: string; union_status?: string }) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    const qs = params.toString();
    return request(`/api/projects${qs ? `?${qs}` : ""}`) as Promise<Project[]>;
  },

  createProject: (data: Partial<Project> & { title: string; city: string; state: string; job_type: string }) =>
    request("/api/projects", { method: "POST", body: JSON.stringify(data) }) as Promise<Project>,

  getProject: (id: string) => request(`/api/projects/${id}`) as Promise<Project>,

  listOwnerDocuments: () => request("/api/owner/documents") as Promise<OwnerDocument[]>,

  addDocumentation: (data: FormData) =>
    request("/api/owner/documents/documentation", { method: "POST", body: data }) as Promise<OwnerDocument>,

  addInsurancePolicy: (data: FormData) =>
    request("/api/owner/documents/insurance", { method: "POST", body: data }) as Promise<OwnerDocument>,

  getOwnerDocumentFile: (id: string, download = false) =>
    requestBlob(`/api/owner/documents/${id}/file${download ? "?download=true" : ""}`),

  getContractorProfile: () => request("/api/contractor/profile") as Promise<ContractorProfile>,
  updateContractorProfile: (data: Partial<ContractorProfile>) =>
    request("/api/contractor/profile", { method: "PATCH", body: JSON.stringify(data) }) as Promise<ContractorProfile>,
  listContractorProjects: () => request("/api/contractor/projects") as Promise<ContractorProject[]>,
  listContractorDocuments: () => request("/api/contractor/documents") as Promise<OwnerDocument[]>,
  addContractorDocumentation: (data: FormData) =>
    request("/api/contractor/documents/documentation", { method: "POST", body: data }) as Promise<OwnerDocument>,
  addContractorInsurance: (data: FormData) =>
    request("/api/contractor/documents/insurance", { method: "POST", body: data }) as Promise<OwnerDocument>,
  getContractorDocumentFile: (id: string, download = false) =>
    requestBlob(`/api/contractor/documents/${id}/file${download ? "?download=true" : ""}`),
  listComplianceTasks: () => request("/api/contractor/tasks") as Promise<ComplianceTask[]>,
  listContractorPhotos: () => request("/api/contractor/photos") as Promise<ContractorPhoto[]>,
  addContractorPhoto: (data: FormData) =>
    request("/api/contractor/photos", { method: "POST", body: data }) as Promise<ContractorPhoto>,
  getContractorPhotoFile: (id: string) => requestBlob(`/api/contractor/photos/${id}/file`),
  listContractorTypes: () => request("/api/contractor/types") as Promise<ContractorType[]>,
  addContractorType: (name: string) =>
    request("/api/contractor/types", { method: "POST", body: JSON.stringify({ name }) }) as Promise<ContractorType>,
  deleteContractorType: (id: string) => request(`/api/contractor/types/${id}`, { method: "DELETE" }),
};
