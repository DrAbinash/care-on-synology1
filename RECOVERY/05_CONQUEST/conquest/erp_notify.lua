-- =============================================================================
-- erp_notify.lua  —  CONQUEST PACS → DiagnoCenter ERP study-intake hook
-- =============================================================================
--
-- PURPOSE
--   Every time CONQUEST stores a DICOM object it calls converter().
--   This script forwards the study metadata to the ERP's internal intake
--   endpoint so the study appears immediately in the PACS Worklist.
--
--   The ERP uses upsert logic keyed on StudyInstanceUID + AccessionNumber,
--   so one HTTP call per image is safe — duplicates are silently merged.
--
-- INSTALLATION  (see CONQUEST_SETUP.md for the full walkthrough)
--   1. Copy this file to:  <ConquestInstallDir>\lua\erp_notify.lua
--   2. Set ERP_URL and ERP_API_KEY below.
--   3. Add/merge into dicom.ini:
--        LuaConvertScript = lua\erp_notify.lua
--   4. Restart the CONQUEST service.
--
-- DEPENDENCIES
--   Option A (preferred):  luasocket  (install via LuaRocks or the CONQUEST
--                          bundled package)  — pure Lua HTTP, no shell needed.
--   Option B (fallback):   curl.exe present on PATH  (built into Windows 10+)
--
-- =============================================================================

-- ── Configuration ─────────────────────────────────────────────────────────────

-- Full HTTPS URL of the ERP's study intake endpoint.
-- Replace YOUR_DOMAIN with your actual .replit.app domain (or custom domain).
local ERP_URL     = "https://YOUR_DOMAIN.replit.app/api/internal/radiology/studies"

-- Must match the INTERNAL_API_KEY secret set in the ERP deployment.
local ERP_API_KEY = "REPLACE_WITH_YOUR_INTERNAL_API_KEY"

-- Set to true to write a debug line to ConquestDICOM.log on every call.
local DEBUG       = false

-- ── JSON escape ───────────────────────────────────────────────────────────────

local function json_escape(s)
  if s == nil then return "" end
  s = tostring(s):gsub('\\', '\\\\')
                 :gsub('"',  '\\"')
                 :gsub('\n', '\\n')
                 :gsub('\r', '\\r')
                 :gsub('\t', '\\t')
                 :gsub('\0', '')
  return s
end

-- ── HTTP POST ─────────────────────────────────────────────────────────────────
-- Tries luasocket first; falls back to curl via a temp-file to avoid
-- shell-quoting issues with patient names that contain special characters.

local function http_post(url, key, body)
  -- Attempt A: luasocket
  local ok_http, http = pcall(require, "socket.http")
  if ok_http and http then
    local ok_ltn12, ltn12 = pcall(require, "ltn12")
    if ok_ltn12 then
      local sink_t = {}
      local _, code = http.request({
        url     = url,
        method  = "POST",
        headers = {
          ["Content-Type"]   = "application/json",
          ["Authorization"]  = "Bearer " .. key,
          ["Content-Length"] = tostring(#body),
        },
        source = ltn12.source.string(body),
        sink   = ltn12.sink.table(sink_t),
      })
      if DEBUG then print("[ERP] luasocket POST → HTTP " .. tostring(code)) end
      return code
    end
  end

  -- Attempt B: curl via temp file
  local tmpfile = os.tmpname() .. "_erp.json"
  local f = io.open(tmpfile, "w")
  if not f then
    if DEBUG then print("[ERP] Could not open temp file for curl fallback") end
    return 0
  end
  f:write(body)
  f:close()

  -- Use curl's --data-binary @file form so no shell-quoting of the JSON body.
  local cmd = string.format(
    'curl -s -o NUL -w "%%{http_code}" -X POST "%s"'
    .. ' -H "Content-Type: application/json"'
    .. ' -H "Authorization: Bearer %s"'
    .. ' --data-binary "@%s"'
    .. ' --max-time 10 --connect-timeout 5',
    url, key, tmpfile
  )
  -- On Linux replace "NUL" with "/dev/null":
  if package.config:sub(1,1) == "/" then
    cmd = cmd:gsub("NUL", "/dev/null")
  end

  local handle = io.popen(cmd)
  local code_str = handle and handle:read("*a") or "000"
  if handle then handle:close() end
  os.remove(tmpfile)

  local code = tonumber(code_str) or 0
  if DEBUG then print("[ERP] curl POST → HTTP " .. tostring(code)) end
  return code
end

-- ── CONQUEST converter() ──────────────────────────────────────────────────────
--
-- CONQUEST sets these globals before calling converter():
--
--   AccessionNumber      (0008,0050)
--   StudyInstanceUID     (0020,000D)
--   PatientID            (0010,0020)
--   PatientsName         (0010,0010)   — note: CONQUEST uses PatientsName
--   Modality             (0008,0060)
--   StudyDescription     (0008,1030)
--   StudyDate            (0008,0020)
--   ReferringPhysiciansName (0008,0090)
--
-- callingae  = AE title of the sending SCU
-- calledae   = AE title of this CONQUEST node
-- ip         = IP address of the sending SCU

function converter(callingae, calledae, ip, port)
  -- AccessionNumber and PatientName are required by the ERP endpoint.
  -- Skip if either is blank (e.g. SR objects, presentation states).
  local accession = AccessionNumber or ""
  if accession == "" then
    if DEBUG then print("[ERP] Skipping: no AccessionNumber") end
    return
  end

  -- CONQUEST stores names as "Last^First^Middle" — normalise to readable form.
  local raw_name   = PatientsName or PatientName or ""
  local patient_name = raw_name:gsub("%^", " "):match("^%s*(.-)%s*$")
  if patient_name == "" then patient_name = "UNKNOWN" end

  local patient_id   = PatientID            or ""
  local study_uid    = StudyInstanceUID     or ""
  local modality     = Modality             or "OT"
  local description  = StudyDescription     or ""
  local study_date   = StudyDate            or ""
  local referring_dr = ReferringPhysiciansName or ""

  local body = string.format(
    '{"patientId":"%s","patientName":"%s","accessionNumber":"%s",'
    .. '"studyInstanceUID":"%s","modality":"%s","studyDescription":"%s",'
    .. '"studyDate":"%s","referringDoctor":"%s","aeTitle":"%s","ipAddress":"%s"}',
    json_escape(patient_id),
    json_escape(patient_name),
    json_escape(accession),
    json_escape(study_uid),
    json_escape(modality),
    json_escape(description),
    json_escape(study_date),
    json_escape(referring_dr),
    json_escape(calledae or ""),
    json_escape(ip or "")
  )

  if DEBUG then
    print(string.format("[ERP] Notifying: accession=%s uid=%s patient=%s",
      accession, study_uid, patient_name))
  end

  local code = http_post(ERP_URL, ERP_API_KEY, body)

  -- Log failures (2xx codes are success). Logged to ConquestDICOM.log.
  if code < 200 or code >= 300 then
    print(string.format(
      "[ERP] WARNING: study intake failed (HTTP %d) — accession=%s uid=%s",
      code, accession, study_uid
    ))
  end
end
