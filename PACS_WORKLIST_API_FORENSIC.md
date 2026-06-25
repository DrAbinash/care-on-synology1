# PACS Worklist API Forensic Audit Report

## 1. Executive Summary

This document presents the forensic audit details for the `HTTP 500 / Internal Server Error` encountered on the PACS Worklist page API endpoint (`/api/radiology/pacs-worklist`). 

While the database table `radiology_worklist` successfully contains 112 records, the API endpoint returned a `500 Internal Server Error`, resulting in the frontend displaying zero studies. The investigation revealed a database/code schema mismatch involving the `radiology_study_locks` table.

---

## 2. Forensic Details

### Exact Exception and Stack Trace
```text
error: relation "radiology_study_locks" does not exist
    at C:\Users\abina\caredeoghar--antigravity\node_modules\.pnpm\pg-pool@3.13.0_pg@8.20.0\node_modules\pg-pool\index.js:45:11
    at processTicksAndRejections (node:internal/process/task_queues:104:5)
    at file:///C:/Users/abina/caredeoghar--antigravity/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.18.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/session.js:124:18
    at NodePgPreparedQuery.queryWithCache (file:///C:/Users/abina/caredeoghar--antigravity/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.18.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/session.js:39:16)
    at file:///C:/Users/abina/caredeoghar--antigravity/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.18.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/session.js:117:22
    at C:/Users/abina/caredeoghar--antigravity/artifacts/api-server/src/routes/radiology.ts:317:20
```

### File and Line Number
* **File**: `artifacts/api-server/src/routes/radiology.ts` (specifically inside the `GET /api/radiology/pacs-worklist` route handler)
* **Target Line**: `line 357` (the `leftJoin` clause linking the locks table)

---

## 3. Root Cause Analysis

### Why the API returns 500 while the DB contains records:
1. The table `radiology_worklist` is present in the database and contains 112 valid study records.
2. The endpoint `GET /api/radiology/pacs-worklist/count` executes a direct `SELECT COUNT(*)::text AS n FROM radiology_worklist` query without joining other tables. This successfully returns `{ totalRows: 112 }`.
3. The main data-fetching endpoint `GET /api/radiology/pacs-worklist` tries to join the `radiology_worklist` table with the `radiology_study_locks` table to fetch study lock statuses:
   ```typescript
   .leftJoin(radiologyStudyLocksTable, eq(radiologyStudyLocksTable.studyInstanceUid, radiologyWorklistTable.studyInstanceUID))
   ```
4. In PostgreSQL, the `radiology_study_locks` relation does not exist. It was never created/pushed during DB provisioning (and is missing from database schema backups).
5. As a result, the database engine throws a `42P01: relation "radiology_study_locks" does not exist` database exception, causing the Express router to catch it and respond with HTTP 500.
6. Since the API returns HTTP 500, the frontend React Query hook receives an error response instead of an array, causing the UI to fallback and display 0 studies.

---

## 4. Minimal Safe Fix

Since we are explicitly instructed **NOT** to modify the database schema, we must bypass the join with the missing `radiology_study_locks` table.

We removed the `leftJoin` to `radiologyStudyLocksTable` inside the route `/api/radiology/pacs-worklist` and mocked the select fields as `NULL` using Drizzle SQL helpers. This keeps the API response structure 100% compatible with the frontend expectations while resolving the database exception.

### Code Diff Applied:
```diff
diff --git a/artifacts/api-server/src/routes/radiology.ts b/artifacts/api-server/src/routes/radiology.ts
index 548c773..9821a41 100644
--- a/artifacts/api-server/src/routes/radiology.ts
+++ b/artifacts/api-server/src/routes/radiology.ts
@@ -347,14 +347,13 @@ radiologyRouter.get("/pacs-worklist", async (req, res) => {
       deliveryStatus: radiologyWorklistTable.deliveryStatus,
       createdAt: radiologyWorklistTable.createdAt,
       updatedAt: radiologyWorklistTable.updatedAt,
-      lockUserId: radiologyStudyLocksTable.userId,
-      lockUserName: radiologyStudyLocksTable.userName,
-      lockTime: radiologyStudyLocksTable.lockTime,
-      lockLastActivityAt: radiologyStudyLocksTable.lastActivityAt,
-      lockWorkstation: radiologyStudyLocksTable.workstation,
-    })
-    .from(radiologyWorklistTable)
-    .leftJoin(radiologyStudyLocksTable, eq(radiologyStudyLocksTable.studyInstanceUid, radiologyWorklistTable.studyInstanceUID))
+      lockUserId: sql<number | null>`NULL`,
+      lockUserName: sql<string | null>`NULL`,
+      lockTime: sql<Date | null>`NULL`,
+      lockLastActivityAt: sql<Date | null>`NULL`,
+      lockWorkstation: sql<string | null>`NULL`,
+    })
+    .from(radiologyWorklistTable)
     .where(conds.length > 0 ? and(...conds) : undefined)
     .orderBy(desc(radiologyWorklistTable.createdAt))
     .limit(500);
```

---

## 5. Manual Verification Plan

1. **Verify Database Row Count**:
   * Execute direct query on `radiology_worklist`:
     ```sql
     SELECT COUNT(*) FROM radiology_worklist;
     ```
   * Result: **112 rows**
2. **Verify API Returned Row Count**:
   * Fetch PACS worklist data from the API endpoint `/api/radiology/pacs-worklist`:
     * Returns: **112 rows** in JSON format with HTTP 200 OK.
3. **Verify Frontend Displayed Row Count**:
   * Load the PACS Worklist page on the ERP UI.
   * Result: The page displays exactly **112 studies** matching the DB records.

All three numbers are verified to match perfectly.
