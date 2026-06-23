-- Conquest PACS — after_import.lua
-- Reference script (from radiology_ris_pacs_integration_bundle).
-- Drop this file into the Conquest PACS scripts directory and configure
-- Conquest to call it after every DICOM study import.
--
-- Configuration (set these variables for your environment):
local ERP_INTERNAL_URL = "http://YOUR_ERP_HOST/api/internal"
local INTERNAL_API_KEY = "YOUR_INTERNAL_API_KEY"

-- Conquest calls this function with the study details after import.
function after_import(server, level, sopinstanceuid, patientid, studyinstanceuid, seriesinstanceuid, filename)
  if level ~= "STUDY" then return end

  local http = require("socket.http")
  local ltn12 = require("ltn12")
  local json = require("json")  -- requires luajson or similar

  -- Build payload
  local payload = json.encode({
    accessionNumber  = server:GetTag(8, 0x50, 0) or sopinstanceuid,
    studyInstanceUID = studyinstanceuid,
    patientId        = patientid,
    patientName      = server:GetTag(0x10, 0x10, 0) or "Unknown",
    modality         = server:GetTag(8, 0x60, 0) or "OT",
    studyDescription = server:GetTag(8, 0x1030, 0) or "",
    studyDate        = server:GetTag(8, 0x20, 0) or "",
    referringDoctor  = server:GetTag(8, 0x90, 0) or "",
    aeTitle          = server:CallingAE or "",
  })

  local response = {}
  local result, status, headers = http.request({
    url     = ERP_INTERNAL_URL .. "/radiology/studies",
    method  = "POST",
    headers = {
      ["Content-Type"]   = "application/json",
      ["Content-Length"] = tostring(#payload),
      ["Authorization"]  = "Bearer " .. INTERNAL_API_KEY,
    },
    source = ltn12.source.string(payload),
    sink   = ltn12.sink.table(response),
  })

  if status ~= 201 then
    server:Log(0, "ERP intake failed: " .. tostring(status) .. " " .. table.concat(response))
  else
    server:Log(1, "ERP intake OK: " .. studyinstanceuid)
  end

  -- Also log the event
  local logPayload = json.encode({
    severity    = "info",
    source      = "conquest",
    eventType   = "STUDY_IMPORTED",
    message     = "Study imported: " .. (server:GetTag(8, 0x1030, 0) or "Unknown"),
    studyInstanceUid = studyinstanceuid,
    accessionNumber  = server:GetTag(8, 0x50, 0) or "",
    modality         = server:GetTag(8, 0x60, 0) or "OT",
  })
  http.request({
    url     = ERP_INTERNAL_URL .. "/radiology/dicom-event",
    method  = "POST",
    headers = {
      ["Content-Type"]   = "application/json",
      ["Content-Length"] = tostring(#logPayload),
      ["Authorization"]  = "Bearer " .. INTERNAL_API_KEY,
    },
    source = ltn12.source.string(logPayload),
    sink   = ltn12.sink.table({}),
  })
end
