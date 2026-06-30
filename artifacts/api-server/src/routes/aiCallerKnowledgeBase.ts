// External AI Caller — Knowledge Base Search.
// The one endpoint Epic 2/3's design actually calls for an external AI
// caller (a future Conversation Manager, Voice Gateway, Website
// Assistant — none of which exist yet, see requireAiCallerAuth.ts) to
// reach. Deliberately separate from routes/knowledgeBase.ts's
// staff-gated router rather than trying to make one router accept two
// different auth schemes — that would risk a subtle bug in shared
// middleware ordering. This router shares the actual search
// implementation with the staff route, runKnowledgeBaseSearch, exported
// from knowledgeBase.ts, so there is exactly one search behavior, just
// two different doors into it with two different locks.

import { Router } from "express";
import { requireAiCallerAuth, type AiCallerAuthRequest } from "../middleware/requireAiCallerAuth";
import { runKnowledgeBaseSearch, SearchQuery } from "./knowledgeBase";

export const aiCallerKnowledgeBaseRouter = Router();

aiCallerKnowledgeBaseRouter.get(
  "/search",
  requireAiCallerAuth("knowledge_base:search"),
  async (req: AiCallerAuthRequest, res): Promise<void> => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const { q, category } = parsed.data;
    // Channel is taken from the authenticated credential's own declared
    // channel, not from a client-supplied query parameter — an AI
    // caller authenticates as a specific channel (e.g. "whatsapp",
    // "voice"), it does not get to claim to be a different one in the
    // search log, which would undermine the per-channel attribution the
    // Knowledge Gaps dashboard depends on being honest.
    const channel = req.aiCaller?.channel ?? "unknown_ai_caller";
    res.json(await runKnowledgeBaseSearch(q, category, channel));
  },
);
