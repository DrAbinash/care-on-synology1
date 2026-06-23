import {
  pgTable, serial, integer, text, boolean, timestamp, index, real,
} from "drizzle-orm/pg-core";

// Phase 9: RAG Vector Store — document embeddings for semantic search.
// Uses pgvector extension (must be installed on the DB server).
// Each row is a chunked document with an embedding vector.
// Phase 10: AI Search & Retrieval queries these embeddings.
export const ragDocumentEmbeddingsTable = pgTable(
  "rag_document_embeddings",
  {
    id: serial("id").primaryKey(),
    documentId: text("document_id").notNull(), // e.g. "report:123" or "template:MRI"
    documentType: text("document_type").notNull(), // report | template | finding | guideline
    content: text("content").notNull(), // the text chunk
    // Embedding vector dimension (384 for sentence-transformers, 1536 for OpenAI)
    // Note: actual vector type requires pgvector extension; fallback to text in non-pgvector envs.
    embedding: text("embedding"), // JSON array of floats as fallback
    embeddingDimension: integer("embedding_dimension").default(384),
    // Metadata for filtering
    modality: text("modality"),
    patientId: integer("patient_id"),
    studyId: integer("study_id"),
    // Source tracking
    sourceUrl: text("source_url"),
    sourceTitle: text("source_title"),
    // Search metrics
    searchCount: integer("search_count").notNull().default(0),
    lastSearchedAt: timestamp("last_searched_at", { withTimezone: true }),
    // Lifecycle
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    docIdIdx: index("rag_doc_doc_id_idx").on(t.documentId),
    typeIdx: index("rag_doc_type_idx").on(t.documentType),
    modalityIdx: index("rag_doc_modality_idx").on(t.modality),
    patientIdx: index("rag_doc_patient_idx").on(t.patientId),
  }),
);
export type RagDocumentEmbedding = typeof ragDocumentEmbeddingsTable.$inferSelect;

// Phase 10: RAG Search Queries — log of search queries and their results
export const ragSearchQueriesTable = pgTable(
  "rag_search_queries",
  {
    id: serial("id").primaryKey(),
    queryText: text("query_text").notNull(),
    embedding: text("embedding"), // JSON array of floats
    // Results
    topK: integer("top_k").notNull().default(5),
    resultsJson: text("results_json"), // JSON array of matched document IDs with scores
    // User context
    userId: integer("user_id"),
    userName: text("user_name"),
    // Performance
    durationMs: integer("duration_ms"),
    // Audit
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    queryIdx: index("rag_search_query_idx").on(t.queryText),
    userIdx: index("rag_search_user_idx").on(t.userId),
  }),
);
export type RagSearchQuery = typeof ragSearchQueriesTable.$inferSelect;
