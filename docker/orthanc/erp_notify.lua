--[[ ==========================================================================
  erp_notify.lua — ORTHANC → Care ERP low-latency study-push hook
  ============================================================================

  PURPOSE
    Orthanc calls OnStableStudy(studyId, ...) the moment a study finishes
    receiving (no new instances for the stabilisation window). This hook POSTs
    that study's Orthanc id to the ERP, which immediately pulls the study
    metadata back from Orthanc and files it into the radiology worklist —
    including running USG measurement extraction for ultrasound studies
    (e.g. GE Voluson E9 obstetric Structured Reports).

    This is the NEAR-INSTANT fast path. The ERP also runs a /changes poller as
    a reliable safety net, so a missed/failed webhook is still picked up within
    the poll interval. Intake is idempotent (upsert on StudyInstanceUID), so a
    study seen by both paths is filed exactly once.

  INSTALLATION
    1. Copy this file next to Orthanc's config, e.g. /etc/orthanc/erp_notify.lua
    2. Set ERP_URL and ERP_API_KEY below (ERP_API_KEY must equal the ERP's
       INTERNAL_API_KEY secret).
    3. Register it in orthanc.json:
         "LuaScripts": [ "/etc/orthanc/erp_notify.lua" ]
       (In docker-compose, mount this file into the care-orthanc container and
        add the path to LuaScripts.)
    4. Restart Orthanc. Confirm "ERP notify hook loaded" in the Orthanc log.

  NOTES
    - StableAge (orthanc.json) controls how long Orthanc waits before a study is
      "stable"; the default 60s is fine.
    - No PHI is sent in the webhook body — only the opaque Orthanc study id. The
      ERP fetches the actual study back over the trusted internal network.
============================================================================ ]]--

-- ── Configuration ────────────────────────────────────────────────────────────

-- Internal ERP webhook URL (container-to-container or LAN). Not browser-facing.
local ERP_URL     = os.getenv("ERP_WEBHOOK_URL")
                    or "http://care-api:8080/api/internal/radiology/orthanc-webhook"

-- Must equal the ERP's INTERNAL_API_KEY secret.
local ERP_API_KEY = os.getenv("ERP_INTERNAL_API_KEY") or "REPLACE_WITH_INTERNAL_API_KEY"

print("ERP notify hook loaded — target " .. ERP_URL)

-- ── Hook ─────────────────────────────────────────────────────────────────────

function OnStableStudy(studyId, tags, metadata)
  -- Body carries only the opaque Orthanc study id; the ERP pulls the rest.
  local body = '{"orthancStudyId":"' .. tostring(studyId) .. '"}'

  local headers = {
    ["Content-Type"]  = "application/json",
    ["Authorization"] = "Bearer " .. ERP_API_KEY,
  }

  -- HttpPost(url, body, headers) — headers arg supported by Orthanc's Lua HTTP
  -- client. Wrapped in pcall so a transient ERP outage never disrupts Orthanc's
  -- own storage pipeline (the /changes poller will reconcile it).
  local ok, err = pcall(function()
    SetHttpTimeout(10)
    HttpPost(ERP_URL, body, headers)
  end)

  if not ok then
    print("[ERP] webhook POST failed for study " .. tostring(studyId) .. ": " .. tostring(err))
  end
end
