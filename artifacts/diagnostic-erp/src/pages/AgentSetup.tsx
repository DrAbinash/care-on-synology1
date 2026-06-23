import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Monitor, Terminal, FolderOpen, RefreshCw, Settings, AlertCircle,
  CheckCircle2, Copy, BookOpen, Server, Activity, MonitorPlay,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const { toast } = useToast();
  return (
    <div className="rounded-lg border bg-slate-950 text-slate-100 overflow-hidden text-sm">
      {label && (
        <div className="px-4 py-1.5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-400">{label}</span>
          <button
            onClick={() => { void navigator.clipboard.writeText(code); toast({ title: "Copied" }); }}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <Copy size={12} />
          </button>
        </div>
      )}
      <pre className="p-4 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center gap-2 bg-muted/30">
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

export function AgentSetupPanel() {
  const { toast } = useToast();

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Overview */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { icon: <Server size={20} />, label: "DICOM Pull Agent", desc: "Queries modalities for new studies and pulls them to local PACS" },
          { icon: <Activity size={20} />, label: "MWL SCP Agent", desc: "Serves modality worklist to CT/MRI/X-Ray via DICOM C-FIND" },
          { icon: <RefreshCw size={20} />, label: "Auto-Config", desc: "Agents fetch configuration from ERP every 5 minutes automatically" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border bg-card p-4">
            <div className="text-primary mb-2">{item.icon}</div>
            <p className="font-semibold text-sm">{item.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Prerequisites */}
      <Section title="Prerequisites" icon={<CheckCircle2 size={15} />}>
        <ul className="space-y-1.5 text-sm">
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> Windows 10/11 or Windows Server 2016+</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> Node.js 18 or later (<a href="https://nodejs.org" className="underline text-primary" target="_blank" rel="noopener noreferrer">nodejs.org</a>)</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> Network access to ERP API (HTTPS recommended)</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> Network access to DICOM modalities (port 104 typically)</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> (Optional) NSSM — for running as Windows Service (<a href="https://nssm.cc" className="underline text-primary" target="_blank" rel="noopener noreferrer">nssm.cc</a>)</li>
          <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-green-500 shrink-0" /> (Optional) DCMTK — for DICOM C-ECHO testing (<a href="https://dcmtk.org" className="underline text-primary" target="_blank" rel="noopener noreferrer">dcmtk.org</a>)</li>
        </ul>
      </Section>

      {/* Installation */}
      <Section title="Installation" icon={<Terminal size={15} />}>
        <p className="text-sm text-muted-foreground">Download the pull agent from your ERP server, or copy from the <code>artifacts/windows-pull-agent/</code> directory.</p>

        <CodeBlock label="Install dependencies" code={`cd C:\\DiagnoAgent
npm install`} />

        <CodeBlock label="Create configuration file (.env or config.json)" code={`# .env — Pull Agent configuration

# ERP API endpoint (required)
ERP_BASE_URL=https://your-erp.replit.app

# Internal API key (from ERP Settings → Internal API)
INTERNAL_API_KEY=your_internal_api_key_here

# Local AE title for this agent
LOCAL_AE_TITLE=DIAGNO_AGENT

# Disable remote config fetch (set to 0 to use local config only)
ERP_CONFIG_ENABLED=1

# Max retries for failed study retrieval
MAX_RETRIES=5

# Polling interval in seconds (default: as set per modality in ERP)
DEFAULT_POLLING_INTERVAL=300`} />
      </Section>

      {/* Starting the agent */}
      <Section title="Start the Agent" icon={<Monitor size={15} />}>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">Start manually (for testing)</p>
            <CodeBlock code={`node C:\\DiagnoAgent\\src\\index.js`} />
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Install as Windows Service (NSSM)</p>
            <CodeBlock label="cmd.exe (run as Administrator)" code={`# Install the service
nssm install DiagnoAgent "C:\\Program Files\\nodejs\\node.exe" "C:\\DiagnoAgent\\src\\index.js"

# Set working directory
nssm set DiagnoAgent AppDirectory "C:\\DiagnoAgent"

# Set environment file
nssm set DiagnoAgent AppEnvironmentExtra ERP_BASE_URL=https://your-erp.replit.app

# Set restart on crash
nssm set DiagnoAgent AppRestartDelay 5000

# Start the service
nssm start DiagnoAgent`} />
          </div>

          <div>
            <p className="text-sm font-medium mb-1">Stop / Restart service</p>
            <CodeBlock code={`nssm stop DiagnoAgent
nssm restart DiagnoAgent`} />
          </div>
        </div>
      </Section>

      {/* Log locations */}
      <Section title="Log Locations" icon={<FolderOpen size={15} />}>
        <div className="space-y-2 text-sm">
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/30 text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2 text-left">Log File</th>
                  <th className="px-4 py-2 text-left">Contents</th>
                  <th className="px-4 py-2 text-left">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  { file: "logs\\agent.log", desc: "General agent activity, polling cycles, config fetch", ret: "30 days" },
                  { file: "logs\\error.log", desc: "Errors and failed operations", ret: "30 days" },
                  { file: "logs\\transfer.log", desc: "C-MOVE/C-GET/C-STORE operations per study", ret: "30 days" },
                ].map((row) => (
                  <tr key={row.file}>
                    <td className="px-4 py-2 font-mono text-xs">{row.file}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{row.desc}</td>
                    <td className="px-4 py-2 text-xs">{row.ret}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CodeBlock label="View latest logs (PowerShell)" code={`# Last 100 lines of agent log
Get-Content C:\\DiagnoAgent\\logs\\agent.log -Tail 100

# Follow live
Get-Content C:\\DiagnoAgent\\logs\\agent.log -Wait -Tail 50`} />
        </div>
      </Section>

      {/* How config fetch works */}
      <Section title="Auto-Configuration (How It Works)" icon={<Settings size={15} />}>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            By default (<code>ERP_CONFIG_ENABLED=1</code>), the agent fetches modality configuration from the ERP every 5 minutes:
          </p>
          <CodeBlock label="Config fetch endpoint" code={`GET ${window.location.origin}/api/internal/dicom-agent/config
Authorization: Bearer <INTERNAL_API_KEY>`} />
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 p-3 text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-300 mb-1">Fallback behaviour</p>
            <ul className="text-blue-700 dark:text-blue-400 space-y-1 text-xs list-disc list-inside">
              <li>If the ERP is unreachable, the agent continues using the last known-good config</li>
              <li>Last known-good config is saved locally to <code>config/last-known-good.json</code></li>
              <li>Set <code>ERP_CONFIG_ENABLED=0</code> to disable remote config entirely and always use local config</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* Weasis configuration */}
      <Section title="Configure Weasis Viewer" icon={<Monitor size={15} />}>
        <div className="space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Install <strong>Weasis</strong> on radiologist workstations from <a href="https://weasis.org" className="underline text-primary" target="_blank" rel="noopener noreferrer">weasis.org</a></li>
            <li>In ERP → <strong>PACS Settings → Viewer Settings</strong>, set <strong>WADO Base URL</strong> to your Conquest or Orthanc WADO endpoint</li>
            <li>Example Conquest WADO URL: <code className="bg-muted px-1 rounded text-xs">http://192.168.1.10:8080/wado</code></li>
            <li>Example Orthanc WADO URL: <code className="bg-muted px-1 rounded text-xs">http://192.168.1.10:8042/wado</code></li>
            <li>Set <strong>Viewer Mode</strong> to <code>WEASIS</code> or <code>BOTH</code></li>
            <li>Click <strong>Open in Weasis</strong> on any study in the Radiology Worklist or PACS Dashboard</li>
          </ol>
          <CodeBlock label="Test Weasis URI scheme (paste in browser)" code={`weasis://$dicom:get -w "http://192.168.1.10:8080/wado" -r "studyUID=1.2.840.10008.5.1.4.1.1.2"`} />
        </div>
      </Section>

      {/* OHIF configuration */}
      <Section title="Configure OHIF Viewer" icon={<MonitorPlay size={15} />}>
        <div className="space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Deploy OHIF Viewer on your network — see <a href="https://docs.ohif.org/deployment" className="underline text-primary" target="_blank" rel="noopener noreferrer">OHIF Deployment Guide</a></li>
            <li>In ERP → <strong>PACS Settings → Viewer Settings</strong>, set <strong>OHIF Base URL</strong></li>
            <li>Example: <code className="bg-muted px-1 rounded text-xs">http://192.168.1.10:3000</code></li>
            <li>Set <strong>DICOMweb Base URL</strong> to your Orthanc DICOMweb endpoint if using Orthanc backend</li>
            <li>Example Orthanc DICOMweb: <code className="bg-muted px-1 rounded text-xs">http://192.168.1.10:8042/dicom-web</code></li>
            <li>Set <strong>Viewer Mode</strong> to <code>OHIF</code> or <code>BOTH</code></li>
          </ol>
          <CodeBlock label="OHIF viewer URL format" code={`<OHIF_BASE_URL>/viewer?StudyInstanceUIDs=<StudyInstanceUID>

# Example:
http://192.168.1.10:3000/viewer?StudyInstanceUIDs=1.2.840.10008.5.1.4.1.1.4.1`} />
        </div>
      </Section>

      {/* Curl tests */}
      <Section title="API Test Commands" icon={<Terminal size={15} />}>
        <div className="space-y-3">
          <CodeBlock label="Test internal MWL endpoint (Windows PowerShell)" code={`$headers = @{ Authorization = "Bearer $env:INTERNAL_API_KEY" }
Invoke-RestMethod -Uri "${window.location.origin}/api/internal/radiology/mwl" -Headers $headers | ConvertTo-Json`} />
          <CodeBlock label="Test DICOM agent config fetch" code={`curl -H "Authorization: Bearer $INTERNAL_API_KEY" \\
  ${window.location.origin}/api/internal/dicom-agent/config`} />
          <CodeBlock label="Test C-ECHO (from ERP)" code={`# Replace 1 with your modality ID
curl -X POST ${window.location.origin}/api/radiology/modalities/1/echo-test \\
  -H "Content-Type: application/json" \\
  -b "connect.sid=<your-session-cookie>"`} />
        </div>
      </Section>

      {/* Troubleshooting */}
      <Section title="Troubleshooting" icon={<AlertCircle size={15} />}>
        <div className="space-y-3 text-sm">
          <div className="space-y-2">
            {[
              { problem: "Agent not polling", solution: "Check ERP_BASE_URL is correct and reachable. Check INTERNAL_API_KEY. See logs/error.log." },
              { problem: "C-ECHO fails (TCP_FALLBACK returned)", solution: "Install DCMTK on the server for real C-ECHO. TCP fallback only checks port reachability." },
              { problem: "Studies found but not pulled", solution: "Ensure retrieveEnabled=true for the modality. Check logs/transfer.log for C-MOVE errors." },
              { problem: "Duplicate studies not skipping", solution: "The agent checks dicom_pulled_studies before retrieval. Verify agent version supports dedup." },
              { problem: "MWL not showing on modality", solution: "Ensure Windows MWL SCP agent is running. Verify station AE title matches the modality config." },
            ].map((item) => (
              <div key={item.problem} className="rounded-lg border p-3">
                <p className="font-medium text-sm">{item.problem}</p>
                <p className="text-xs text-muted-foreground mt-1">{item.solution}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

export default function AgentSetup() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader title="Windows Agent Setup" subtitle="DICOM Pull Agent & MWL SCP — installation and configuration guide" />
      <AgentSetupPanel />
    </div>
  );
}
