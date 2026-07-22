/**
 * useFindingsLibrary — single source for the Report Builder findings catalogue.
 *
 * Templates/regions come from the shipped static asset. Findings come from the
 * editable DB library (GET /api/radiology/finding-library); until it has been
 * seeded, we fall back to the static "starter" findings so the builder works
 * out of the box. Once seeded, staff edits (add/modify/delete) flow through.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";

export interface Finding {
  id: string; text: string; modality: string; region: string; section: string;
  impression: boolean; abnormal: boolean; frequency: number; keywords: string[];
  source?: string;
}
export interface TemplateSection { section: string; normal: string }
export interface StudyTemplate {
  id: string; modality: string; region: string; label: string;
  technique: string; sections: TemplateSection[]; normalImpression: string;
  sampleCount: number; normalCount: number;
}
interface StaticLibrary {
  modalities: string[]; regions: { key: string; label: string }[];
  stats: { sourceReports: number; findings: number; templates: number };
  templates: StudyTemplate[]; findings: Finding[];
}

const STATIC_KEY = ["radiology-findings-library-static"];
const DB_KEY = ["radiology-finding-library-db"];
const META_KEY = ["radiology-finding-library-meta"];

export function useStaticLibrary() {
  return useQuery<StaticLibrary>({
    queryKey: STATIC_KEY,
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}data/radiology-findings-library.json`);
      if (!res.ok) throw new Error(`Failed to load findings library (${res.status})`);
      return res.json() as Promise<StaticLibrary>;
    },
    staleTime: Infinity,
  });
}

export function useFindingLibraryMeta() {
  return useQuery<{ seeded: boolean; count: number; starterCount: number }>({
    queryKey: META_KEY,
    queryFn: () => api.get("/api/radiology/finding-library/meta"),
    staleTime: 30_000,
  });
}

export function useFindingsLibrary() {
  const staticQ = useStaticLibrary();
  const metaQ = useFindingLibraryMeta();
  const seeded = metaQ.data?.seeded === true;

  const dbQ = useQuery<{ findings: Finding[] }>({
    queryKey: DB_KEY,
    queryFn: () => api.get("/api/radiology/finding-library"),
    enabled: seeded,          // only hit the DB once it's been seeded
    staleTime: 30_000,
  });

  const findings = useMemo<Finding[]>(() => {
    if (seeded && dbQ.data) {
      return dbQ.data.findings.map((f) => ({ ...f, region: f.region ?? "", keywords: f.keywords ?? [] }));
    }
    return staticQ.data?.findings ?? [];
  }, [seeded, dbQ.data, staticQ.data]);

  return {
    isLoading: staticQ.isLoading || metaQ.isLoading || (seeded && dbQ.isLoading),
    isError: staticQ.isError,
    templates: staticQ.data?.templates ?? [],
    regions: staticQ.data?.regions ?? [],
    modalities: staticQ.data?.modalities ?? ["CT", "USG", "XRAY", "MRI"],
    findings,
    starterFindings: staticQ.data?.findings ?? [],
    seeded,
    metaCount: metaQ.data?.count ?? 0,
    refetchMeta: metaQ.refetch,
  };
}

export const FINDING_LIBRARY_KEYS = { db: DB_KEY, meta: META_KEY, static: STATIC_KEY };
