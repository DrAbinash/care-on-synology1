import { api } from "@/lib/fetchApi";
import type { AiReportingQueryRequest, AiReportingQueryResponse } from "@workspace/api-zod";

/**
 * Single typed entry point for POST /api/ai-reporting/query.
 *
 * Every workstation surface must call the endpoint through this helper so the
 * request stays on the canonical contract (`promptText` — the server also
 * accepts the legacy `prompt` alias for old callers, but new code never sends
 * it). The aiQueryContract source test enforces that this file is the only
 * place in the ERP that references the endpoint path.
 *
 * Images are selected server-side from Orthanc by StudyInstanceUID; the client
 * can only cap the count (`maxImages: 0` = text-only query).
 */
export function queryAiReporting(request: AiReportingQueryRequest): Promise<AiReportingQueryResponse> {
  return api.post<AiReportingQueryResponse>("/api/ai-reporting/query", request);
}

export type { AiReportingQueryRequest, AiReportingQueryResponse };
