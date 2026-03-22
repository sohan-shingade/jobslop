export interface Job {
  id: string;
  title: string;
  company: string;
  company_slug: string | null;
  company_size: string | null;
  company_domain: string | null;
  location: string | null;
  remote: boolean;
  hybrid: boolean;
  url: string;
  posted_date: string | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  department: string | null;
  job_type: string | null;
  industry: string | null;
  skills: string | null; // JSON array
  category: string | null;
  source_platform: string | null;
  company_description: string | null;
  vc_backers: string[]; // joined from job_vc_backers
}

export interface Filters {
  q?: string;
  seniority?: string[];
  remote?: boolean;
  department?: string[];
  industry?: string[];
  vc?: string[];
  company_size?: string[];
  location?: string[];
  category?: string[];
  us_only?: boolean;
}

export type SortField =
  | "posted_date"
  | "salary_max"
  | "company";

export type SortDir = "asc" | "desc";

export interface FilterOptions {
  seniorities: string[];
  departments: string[];
  industries: string[];
  vcs: string[];
  company_sizes: string[];
  locations: string[];
  categories: string[];
}
