-- Care Diagnostics Orthanc — stored-instance hook (logging only).
-- Orthanc→ERP intake is handled by care-erp-sync (care_erp_sync.py).
-- Do NOT add HTTP POST here unless you disable care-erp-sync (avoids double intake).

function OnStoredInstance(instanceId, tags, metadata, origin)
  print("CARE ORTHANC: stored instance " .. instanceId)
end
