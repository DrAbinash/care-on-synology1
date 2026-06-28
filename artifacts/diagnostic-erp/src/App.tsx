import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { readStaffSession, canAccess, firstPermissionedPath, firstAllowedPath, longestMatchingNavPath, FULL_ACCESS_ROLES, normalizeRole } from "@/lib/staffSession";


const BillingDesk     = lazy(() => import("@/pages/BillingDesk"));
const Dashboard       = lazy(() => import("@/pages/Dashboard"));
const Patients        = lazy(() => import("@/pages/Patients"));
const PatientDetail   = lazy(() => import("@/pages/PatientDetail"));
const Tests           = lazy(() => import("@/pages/Tests"));
const Orders          = lazy(() => import("@/pages/Orders"));
const OrderDetail     = lazy(() => import("@/pages/OrderDetail"));
const Billing         = lazy(() => import("@/pages/Billing"));
const BillDetail      = lazy(() => import("@/pages/BillDetail"));
const Payments        = lazy(() => import("@/pages/Payments"));
const Doctors         = lazy(() => import("@/pages/Doctors"));
const Reports         = lazy(() => import("@/pages/Reports"));
const ReportGenerator = lazy(() => import("@/pages/ReportGenerator"));
const Inventory       = lazy(() => import("@/pages/Inventory"));
const Referrals       = lazy(() => import("@/pages/Referrals"));
const Accounting      = lazy(() => import("@/pages/Accounting"));
const Banking         = lazy(() => import("@/pages/Banking"));
const Register        = lazy(() => import("@/pages/Register"));
const Settings        = lazy(() => import("@/pages/Settings"));
const SystemUpdate    = lazy(() => import("@/pages/SystemUpdate"));
const Dues            = lazy(() => import("@/pages/Dues"));
const DicomNodes      = lazy(() => import("@/pages/DicomNodes"));
const Discounts       = lazy(() => import("@/pages/Discounts"));
const PACS            = lazy(() => import("@/pages/PACS"));
const Appointments    = lazy(() => import("@/pages/Appointments"));
const Packages        = lazy(() => import("@/pages/Packages"));
const Expenses        = lazy(() => import("@/pages/Expenses"));
const DayClose        = lazy(() => import("@/pages/DayClose"));
const MyDayClose      = lazy(() => import("@/pages/MyDayClose"));
const BooksSanity     = lazy(() => import("@/pages/BooksSanity"));
const Staff           = lazy(() => import("@/pages/Staff"));
const HRForms         = lazy(() => import("@/pages/HRForms"));
const QueuePage       = lazy(() => import("@/pages/Queue"));
const Radiology       = lazy(() => import("@/pages/Radiology"));
const RadiologyLegacy = lazy(() => import("@/pages/RadiologyLegacy"));
const RadiologyWorklist = lazy(() => import("@/pages/RadiologyWorklist"));
const RadiologistCockpit = lazy(() => import("@/pages/RadiologistCockpit"));
const RadiologyReportEditor = lazy(() => import("@/pages/RadiologyReportEditor"));
const RadiologyReportUnified = lazy(() => import("@/pages/RadiologyReportUnified"));
const RadiologyReportGen = lazy(() => import("@/pages/RadiologyReportGenerator"));
const RadiologyReportingWorkspace = lazy(() => import("@/pages/RadiologyReportingWorkspace"));
const PacsDashboard         = lazy(() => import("@/pages/PacsDashboard"));
const RadiologySettings     = lazy(() => import("@/pages/RadiologySettings"));
const RadiologySettingsCenter = lazy(() => import("@/pages/RadiologySettingsCenter"));
const RadiologyOperationsDashboard = lazy(() => import("@/pages/RadiologyOperationsDashboard"));
const MyReportingAnalytics         = lazy(() => import("@/pages/MyReportingAnalytics"));
const AiPromptTemplates     = lazy(() => import("@/pages/AiPromptTemplates"));
const AiPromptManager       = lazy(() => import("@/pages/AiPromptManager"));
const AiComparisonWorkspace = lazy(() => import("@/pages/AiComparisonWorkspace"));
const MissedFindingDetector = lazy(() => import("@/pages/MissedFindingDetector"));
const ImageReviewAssistant  = lazy(() => import("@/pages/ImageReviewAssistant"));
const ProviderFallback      = lazy(() => import("@/pages/ProviderFallback"));
const TeachingFiles         = lazy(() => import("@/pages/TeachingFiles"));
const TeachingCaseDetail    = lazy(() => import("@/pages/TeachingCaseDetail"));
const TeachingCollections   = lazy(() => import("@/pages/TeachingCaseCollections"));
const TeachingFavorites     = lazy(() => import("@/pages/TeachingFavorites"));
const TeachingAIAssistant   = lazy(() => import("@/pages/TeachingAIAssistant"));
const TeachingResearchMode  = lazy(() => import("@/pages/TeachingResearchMode"));
const TeachingMode          = lazy(() => import("@/pages/TeachingMode"));
const TeachingAnalytics     = lazy(() => import("@/pages/TeachingAnalytics"));
const TeachingPresentationMode = lazy(() => import("@/pages/TeachingPresentationMode"));
const RadiologyProductivity   = lazy(() => import("@/pages/RadiologyProductivity"));
const AiModelRouting        = lazy(() => import("@/pages/AiModelRouting"));
const ReportTemplatesPage   = lazy(() => import("@/pages/ReportTemplates"));
const AiAuditLog            = lazy(() => import("@/pages/AiAuditLog"));
const AiQualityScores       = lazy(() => import("@/pages/AiQualityScores"));
const AiPromptEffectiveness = lazy(() => import("@/pages/AiPromptEffectiveness"));
const AiDicomFindings       = lazy(() => import("@/pages/AiDicomFindings"));
const RagVectorStore        = lazy(() => import("@/pages/RagVectorStore"));
const AiSearchRetrieval     = lazy(() => import("@/pages/AiSearchRetrieval"));
const AnomalyAlerts         = lazy(() => import("@/pages/AnomalyAlerts"));
const ReportDiffViewer      = lazy(() => import("@/pages/ReportDiffViewer"));
const FeedbackLoopAnalytics = lazy(() => import("@/pages/FeedbackLoopAnalytics"));
const TemplateVersions      = lazy(() => import("@/pages/TemplateVersions"));
const AiBillingSuggestions  = lazy(() => import("@/pages/AiBillingSuggestions"));
const PeerReviewAssignments = lazy(() => import("@/pages/PeerReviewAssignments"));
const TurnaroundTimeAnalytics = lazy(() => import("@/pages/TurnaroundTimeAnalytics"));
const TrainingDataExports   = lazy(() => import("@/pages/TrainingDataExports"));
const ReportQualityGates    = lazy(() => import("@/pages/ReportQualityGates"));
const CriticalFindings      = lazy(() => import("@/pages/CriticalFindings"));
const ProviderHealthMonitor = lazy(() => import("@/pages/ProviderHealthMonitor"));
const CommandCenter         = lazy(() => import("@/pages/CommandCenter"));
const VoiceDictation        = lazy(() => import("@/pages/VoiceDictation"));
const PatientCommunication  = lazy(() => import("@/pages/PatientCommunication"));
const NormalReportTemplates = lazy(() => import("@/pages/NormalReportTemplates"));
const DicomViewer           = lazy(() => import("@/pages/DicomViewer"));
const AgentSetup            = lazy(() => import("@/pages/AgentSetup"));
const PacsSettings          = lazy(() => import("@/pages/PacsSettings"));
const PacsLogs              = lazy(() => import("@/pages/PacsLogs"));
const DicomAgentDashboard   = lazy(() => import("@/pages/DicomAgentDashboard"));
const ModalityManagement    = lazy(() => import("@/pages/ModalityManagement"));
const AiReportingSettings   = lazy(() => import("@/pages/AiReportingSettings"));
const MyCollection          = lazy(() => import("@/pages/MyCollection"));
const PacsArchiveLifecycle  = lazy(() => import("@/pages/PacsArchiveLifecycle"));
const PacsWatchdogDashboard = lazy(() => import("@/pages/PacsWatchdogDashboard"));
const AiInferenceSettings   = lazy(() => import("@/pages/AiInferenceSettings"));
const Hl7Settings           = lazy(() => import("@/pages/Hl7Settings"));
const BackupReplication     = lazy(() => import("@/pages/BackupReplication"));
const UsgMeasurementReview  = lazy(() => import("@/pages/UsgMeasurementReview"));
const UsgAdminSettings      = lazy(() => import("@/pages/UsgAdminSettings"));
const UsgDoppler            = lazy(() => import("@/pages/UsgDoppler"));
const UsgWorklist           = lazy(() => import("@/pages/UsgWorklist"));
const UsgReporting          = lazy(() => import("@/pages/UsgReporting"));
const UsgDopplerReporting   = lazy(() => import("@/pages/UsgDopplerReporting"));
const UsgKeyImagesGallery   = lazy(() => import("@/pages/UsgKeyImagesGallery"));
const UsgCriticalAlerts     = lazy(() => import("@/pages/UsgCriticalAlerts"));
const UsgAnalytics          = lazy(() => import("@/pages/UsgAnalytics"));
const PregnancyDashboard    = lazy(() => import("@/pages/PregnancyDashboard"));
const ReportHub       = lazy(() => import("@/pages/ReportHub"));
const Machines        = lazy(() => import("@/pages/Machines"));
const FormF           = lazy(() => import("@/pages/FormF"));
const Website         = lazy(() => import("@/pages/Website"));
const WhatsAppChatbot = lazy(() => import("@/pages/WhatsAppChatbot"));
const Portal          = lazy(() => import("@/pages/Portal"));
const VerifyReceipt   = lazy(() => import("@/pages/VerifyReceipt"));
const Display         = lazy(() => import("@/pages/Display"));
const OnlineBookings  = lazy(() => import("@/pages/OnlineBookings"));
const DicomStudyWorklist    = lazy(() => import("@/pages/DicomStudyWorklist"));
const RadiologistQueue      = lazy(() => import("@/pages/RadiologistQueue"));
const TechnicianWorkflow    = lazy(() => import("@/pages/TechnicianWorkflow"));
const AiExtractionReview    = lazy(() => import("@/pages/AiExtractionReview"));
const HangingProtocols      = lazy(() => import("@/pages/HangingProtocols"));
const TeleradiologyPortal = lazy(() => import("@/pages/TeleradiologyPortal"));
const MobileViewer    = lazy(() => import("@/pages/MobileViewer"));
const DailySummary    = lazy(() => import("@/pages/DailySummary"));
const MyDailySummary  = lazy(() => import("@/pages/MyDailySummary"));
const OutsourcedLabs       = lazy(() => import("@/pages/OutsourcedLabs"));
const OutsourcedCostReport = lazy(() => import("@/pages/OutsourcedCostReport"));
const OutsourceSettings       = lazy(() => import("@/pages/OutsourceSettings"));
const OutsourceRateCards      = lazy(() => import("@/pages/OutsourceRateCards"));
const OutsourceWorklist       = lazy(() => import("@/pages/OutsourceWorklist"));
const OutsourceReconciliation = lazy(() => import("@/pages/OutsourceReconciliation"));
const OutsourceLedger         = lazy(() => import("@/pages/OutsourceLedger"));
const OutsourceDashboard      = lazy(() => import("@/pages/OutsourceDashboard"));
const Samples              = lazy(() => import("@/pages/Samples"));
const ScanStation     = lazy(() => import("@/pages/ScanStation"));
const ReportDelivery  = lazy(() => import("@/pages/ReportDelivery"));
const Kiosk           = lazy(() => import("@/pages/Kiosk"));
const NotFound        = lazy(() => import("@/pages/not-found"));
const NetworkControlCenter = lazy(() => import("@/pages/NetworkControlCenter"));
const RadiologyCommandCenter = lazy(() => import("@/pages/RadiologyCommandCenter"));
const RadiologyAdvancedTools = lazy(() => import("@/pages/RadiologyAdvancedTools"));
const AcquisitionGateway     = lazy(() => import("@/pages/AcquisitionGateway"));
const MwlManager             = lazy(() => import("@/pages/MwlManager"));
const AiPipelineManager      = lazy(() => import("@/pages/AiPipelineManager"));
const CriticalAlertsManager  = lazy(() => import("@/pages/CriticalAlertsManager"));
const StorageLifecycle       = lazy(() => import("@/pages/StorageLifecycle"));
const RadiologistTools       = lazy(() => import("@/pages/RadiologistTools"));
const EchoCardiology         = lazy(() => import("@/pages/EchoCardiology"));
const FetalEcho              = lazy(() => import("@/pages/FetalEcho"));
const FetalUsgLevel4         = lazy(() => import("@/pages/FetalUsgLevel4"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  },
});

const ERP_NAV_ORDER = [
  "/", "/dashboard", "/my-daily-summary", "/daily-summary", "/patients", "/appointments", "/queue", "/online-bookings",
  "/radiology", "/radiology/cockpit", "/radiology/legacy", "/radiology/worklist", "/radiology/report-generator", "/radiology/reporting-workspace", "/radiology/advanced-tools", "/radiology/pacs-dashboard", "/radiology/pacs-settings", "/radiology/network-control-center", "/radiology/pacs-logs",
  "/radiology/dicom-agent-dashboard", "/radiology/modality-management",
  "/radiology/agent-setup", "/radiology/ai-reporting-settings", "/radiology/ai-prompt-templates", "/radiology/ai-model-routing", "/radiology/structured-report-templates", "/radiology/ai-audit-log",
  "/radiology/viewer", "/radiology/archive-lifecycle", "/radiology/watchdog", "/radiology/ai-inference-settings", "/radiology/hl7-settings", "/teleradiology",
  "/radiology/usg-measurements", "/radiology/usg-admin-settings",
  "/usg", "/usg/worklist", "/usg/measurements", "/usg/reporting", "/usg/doppler", "/usg/key-images", "/usg/settings", "/usg/critical", "/usg/analytics",
  "/teaching-cases", "/teaching-collections", "/teaching-favorites", "/teaching-ai", "/teaching-research", "/teaching-mode", "/teaching-analytics", "/teaching-presentation",
  "/echo", "/fetal-echo", "/fetal-usg", "/fetal-usg/:studyId",
  "/settings/radiology", "/backup-replication",
  "/orders", "/tests", "/packages", "/billing", "/payments", "/reports",
  "/report-generator", "/report-hub", "/inventory", "/expenses", "/staff", "/referrals",
  "/accounting", "/discounts", "/form-f", "/machines", "/hr-forms", "/website", "/whatsapp-chatbot", "/settings",
  "/samples",
  "/pacs", "/dicom-nodes",
  "/outsource/settings", "/outsource/rate-cards", "/outsource/worklist", "/outsource/reconciliation", "/outsource/ledger", "/outsource/dashboard",
];

function PermissionGuard() {
  const [location, navigate] = useLocation();
  useEffect(() => {
    const session = readStaffSession();
    if (!session) {
      navigate("/portal", { replace: true });
      return;
    }
    // Owner Dashboard is admin/super_admin only — redirect others to My Daily Summary.
    const normalizedRole = normalizeRole(session.user.role);
    if (location === "/dashboard" && !FULL_ACCESS_ROLES.has(normalizedRole)) {
      navigate("/my-daily-summary", { replace: true });
      return;
    }
    // Super Admin Portal is super_admin only
    if (location.startsWith("/super-admin-portal") && normalizedRole !== "super_admin") {
      navigate("/", { replace: true });
      return;
    }
    // Redirect root "/" to user's default start page if configured and allowed
    if (location === "/" && session.user.defaultStartPage && session.user.defaultStartPage !== "/" && canAccess(session, session.user.defaultStartPage)) {
      navigate(session.user.defaultStartPage, { replace: true });
      return;
    }
    const matched = longestMatchingNavPath(location, ERP_NAV_ORDER);
    const pathToCheck = matched ?? location;
    if (!canAccess(session, pathToCheck)) {
      let target = "/";
      if (session.user.defaultStartPage && canAccess(session, session.user.defaultStartPage)) {
        target = session.user.defaultStartPage;
      } else {
        target = firstPermissionedPath(session, ERP_NAV_ORDER) ?? firstAllowedPath(session, ERP_NAV_ORDER);
      }
      navigate(target, { replace: true });
    }
  }, [location, navigate]);
  return null;
}

function Router() {
  const [portalLoaded, setPortalLoaded] = useState(() => typeof window !== "undefined" && !!(window as any).SuperAdminPortal);

  useEffect(() => {
    const handleLoaded = () => setPortalLoaded(true);
    const handleUnloaded = () => setPortalLoaded(false);

    window.addEventListener("superadmin-ui-loaded", handleLoaded);
    window.addEventListener("superadmin-ui-unloaded", handleUnloaded);

    return () => {
      window.removeEventListener("superadmin-ui-loaded", handleLoaded);
      window.removeEventListener("superadmin-ui-unloaded", handleUnloaded);
    };
  }, []);

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/portal" component={Portal} />
        <Route path="/portal/:rest*" component={Portal} />
        <Route path="/erp/portal" component={Portal} />
        <Route path="/erp/portal/:rest*" component={Portal} />
        <Route path="/teleradiology" component={TeleradiologyPortal} />
        <Route path="/teleradiology/:rest*" component={TeleradiologyPortal} />
        <Route path="/verify-receipt/:billId" component={VerifyReceipt} />
        <Route path="/display" component={Display} />
        <Route path="/kiosk" component={Kiosk} />
        <Route>
          <PermissionGuard />
          <Layout>
            <Switch>
              <Route path="/" component={BillingDesk} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/patients" component={Patients} />
              <Route path="/patients/:id">
                {(params) => <PatientDetail id={Number(params.id)} />}
              </Route>
              <Route path="/tests" component={Tests} />
              <Route path="/orders" component={Orders} />
              <Route path="/orders/:id">
                {(params) => <OrderDetail id={Number(params.id)} />}
              </Route>
              <Route path="/billing" component={Billing} />
              <Route path="/billing/:id">
                {(params) => <BillDetail id={Number(params.id)} />}
              </Route>
              <Route path="/payments" component={Payments} />
              <Route path="/dues" component={Dues} />
              <Route path="/doctors" component={Doctors} />
              <Route path="/reports" component={Reports} />
              <Route path="/report-generator" component={ReportGenerator} />
              <Route path="/report-hub" component={ReportHub} />
              <Route path="/inventory" component={Inventory} />
              <Route path="/referrals" component={Referrals} />
              <Route path="/accounting" component={Accounting} />
              <Route path="/banking" component={Banking} />
              <Route path="/register" component={Register} />
              <Route path="/discounts" component={Discounts} />
              <Route path="/pacs" component={PACS} />
              <Route path="/dicom-nodes" component={DicomNodes} />
              <Route path="/appointments" component={Appointments} />
              <Route path="/daily-summary" component={DailySummary} />
              <Route path="/my-daily-summary" component={MyDailySummary} />
              <Route path="/online-bookings" component={OnlineBookings} />
              <Route path="/queue" component={QueuePage} />
              <Route path="/radiology" component={Radiology} />
              <Route path="/radiology/cockpit" component={RadiologistCockpit} />
              <Route path="/radiology/my-collection" component={MyCollection} />
              <Route path="/radiology/worklist" component={RadiologyWorklist} />
              <Route path="/radiology/report-generator">
                {() => <RadiologyReportGen />}
              </Route>
              <Route path="/radiology/report-generator/:studyId">
                {(params) => <RadiologyReportGen studyId={Number(params.studyId)} />}
              </Route>
              <Route path="/radiology/report/:studyId">
                {(params) => <RadiologyReportEditor studyId={Number(params.studyId)} />}
              </Route>
              <Route path="/radiology/reporting-workspace">
                {() => <RadiologyReportingWorkspace />}
              </Route>
              <Route path="/radiology/reporting-workspace/:studyId">
                {(params) => <RadiologyReportingWorkspace studyId={Number(params.studyId)} />}
              </Route>
              <Route path="/radiology/unified-report/:worklistId">
                {(params) => <RadiologyReportingWorkspace studyId={Number(params.worklistId)} />}
              </Route>
              <Route path="/radiology/pacs-dashboard" component={PacsDashboard} />
              <Route path="/radiology/operations-dashboard" component={RadiologyOperationsDashboard} />
              <Route path="/radiology/my-analytics" component={MyReportingAnalytics} />
              <Route path="/radiology/pacs-settings" component={PacsSettings} />
              <Route path="/radiology/network-control-center" component={NetworkControlCenter} />
              <Route path="/radiology/pacs-logs" component={PacsLogs} />
              <Route path="/radiology/dicom-agent-dashboard" component={DicomAgentDashboard} />
              <Route path="/radiology/modality-management" component={ModalityManagement} />
              <Route path="/radiology/viewer/:studyInstanceUID" component={DicomViewer} />
              <Route path="/radiology/agent-setup" component={AgentSetup} />
              <Route path="/radiology/ai-reporting-settings" component={AiReportingSettings} />
              <Route path="/radiology/ai-prompt-templates" component={AiPromptTemplates} />
              <Route path="/radiology/ai-prompt-manager" component={AiPromptManager} />
              <Route path="/radiology/ai-comparison" component={AiComparisonWorkspace} />
              <Route path="/radiology/missed-finding-detector" component={MissedFindingDetector} />
              <Route path="/radiology/image-review" component={ImageReviewAssistant} />
              <Route path="/radiology/provider-fallback" component={ProviderFallback} />
              <Route path="/teaching-cases" component={TeachingFiles} />
              <Route path="/teaching-cases/:id" component={TeachingCaseDetail} />
              <Route path="/teaching-collections" component={TeachingCollections} />
              <Route path="/teaching-collections/:id" component={TeachingCollections} />
              <Route path="/teaching-favorites" component={TeachingFavorites} />
              <Route path="/teaching-ai" component={TeachingAIAssistant} />
              <Route path="/teaching-research" component={TeachingResearchMode} />
              <Route path="/teaching-mode" component={TeachingMode} />
              <Route path="/teaching-analytics" component={TeachingAnalytics} />
              <Route path="/teaching-presentation" component={TeachingPresentationMode} />
              <Route path="/radiology/productivity" component={RadiologyProductivity} />
              <Route path="/radiology/ai-model-routing" component={AiModelRouting} />
              <Route path="/radiology/structured-report-templates" component={ReportTemplatesPage} />
              <Route path="/radiology/ai-audit-log" component={AiAuditLog} />
      <Route path="/radiology/ai-quality-scores" component={AiQualityScores} />
      <Route path="/radiology/ai-prompt-effectiveness" component={AiPromptEffectiveness} />
      <Route path="/radiology/ai-dicom-findings" component={AiDicomFindings} />
      <Route path="/radiology/rag-vector-store" component={RagVectorStore} />
      <Route path="/radiology/ai-search-retrieval" component={AiSearchRetrieval} />
      <Route path="/radiology/anomaly-alerts" component={AnomalyAlerts} />
      <Route path="/radiology/report-diff" component={ReportDiffViewer} />
      <Route path="/radiology/feedback-loop-analytics" component={FeedbackLoopAnalytics} />
      <Route path="/radiology/template-versions" component={TemplateVersions} />
      <Route path="/radiology/billing-suggestions" component={AiBillingSuggestions} />
      <Route path="/radiology/peer-review-assignments" component={PeerReviewAssignments} />
      <Route path="/radiology/turnaround-times" component={TurnaroundTimeAnalytics} />
      <Route path="/radiology/training-data-exports" component={TrainingDataExports} />
      <Route path="/radiology/quality-gates" component={ReportQualityGates} />
      <Route path="/radiology/critical-findings" component={CriticalFindings} />
      <Route path="/radiology/provider-health" component={ProviderHealthMonitor} />
      <Route path="/radiology/voice-dictation" component={VoiceDictation} />
      <Route path="/radiology/patient-communication" component={PatientCommunication} />
      <Route path="/radiology/normal-templates" component={NormalReportTemplates} />
              <Route path="/radiology/archive-lifecycle" component={PacsArchiveLifecycle} />
              <Route path="/radiology/watchdog" component={PacsWatchdogDashboard} />
              <Route path="/radiology/ai-inference-settings" component={AiInferenceSettings} />
              <Route path="/radiology/hl7-settings" component={Hl7Settings} />
              {/* Phase 12: Real Radiology Workflow & DICOM Operations */}
              <Route path="/radiology/command-center/:studyId">
                {(params) => <RadiologyCommandCenter studyId={Number(params.studyId)} />}
              </Route>
              <Route path="/radiology/command-center">
                {() => <RadiologyCommandCenter />}
              </Route>
              <Route path="/radiology/legacy" component={RadiologyLegacy} />
              <Route path="/radiology/advanced-tools" component={RadiologyAdvancedTools} />
              <Route path="/radiology/acquisition-gateway" component={AcquisitionGateway} />
              <Route path="/radiology/mwl-manager" component={MwlManager} />
              <Route path="/radiology/ai-pipeline" component={AiPipelineManager} />
              <Route path="/radiology/critical-alerts" component={CriticalAlertsManager} />
              <Route path="/radiology/storage-lifecycle" component={StorageLifecycle} />
              <Route path="/radiology/productivity-tools" component={RadiologistTools} />
              <Route path="/radiology/usg-measurements/:studyInstanceUID" component={UsgMeasurementReview} />
              <Route path="/radiology/usg-measurements" component={UsgMeasurementReview} />
              <Route path="/radiology/usg-admin-settings" component={UsgAdminSettings} />
              {/* USG / DOPPLER module */}
              <Route path="/usg" component={UsgDoppler} />
              <Route path="/usg/worklist" component={UsgWorklist} />
              <Route path="/usg/measurements/:studyInstanceUID" component={UsgMeasurementReview} />
              <Route path="/usg/measurements" component={UsgMeasurementReview} />
              <Route path="/usg/reporting" component={UsgReporting} />
              <Route path="/usg/doppler" component={UsgDopplerReporting} />
              <Route path="/usg/key-images" component={UsgKeyImagesGallery} />
              <Route path="/usg/critical" component={UsgCriticalAlerts} />
              <Route path="/usg/settings" component={UsgAdminSettings} />
              <Route path="/usg/analytics" component={UsgAnalytics} />
              <Route path="/usg/pregnancy-dashboard" component={PregnancyDashboard} />
              <Route path="/backup-replication" component={BackupReplication} />
              {/* Phase 10 RIS/PACS Foundation */}
              <Route path="/radiology/dicom-study-worklist" component={DicomStudyWorklist} />
              <Route path="/radiology/radiologist-queue" component={RadiologistQueue} />
              <Route path="/radiology/technician-workflow/:studyId">
                {(params) => <TechnicianWorkflow studyId={Number(params.studyId)} />}
              </Route>
              <Route path="/radiology/technician-workflow">
                {() => <TechnicianWorkflow />}
              </Route>
              <Route path="/radiology/ai-extraction-review" component={AiExtractionReview} />
              <Route path="/radiology/hanging-protocols" component={HangingProtocols} />
              <Route path="/echo" component={EchoCardiology} />
              <Route path="/fetal-echo" component={FetalEcho} />
              <Route path="/fetal-usg" component={FetalUsgLevel4} />
              <Route path="/fetal-usg/:studyId">
                {(params) => <FetalUsgLevel4 />}
              </Route>
              <Route path="/m/viewer/:studyInstanceUID" component={MobileViewer} />
              <Route path="/packages" component={Packages} />
              <Route path="/expenses" component={Expenses} />
              <Route path="/my-day-close" component={MyDayClose} />
              <Route path="/day-close" component={DayClose} />
              <Route path="/books-sanity" component={BooksSanity} />
              <Route path="/staff" component={Staff} />
              <Route path="/hr-forms" component={HRForms} />
              <Route path="/form-f" component={FormF} />
              <Route path="/machines" component={Machines} />
              <Route path="/website" component={Website} />
              <Route path="/outsourced-labs" component={OutsourcedLabs} />
              <Route path="/outsourced-cost-report" component={OutsourcedCostReport} />
              <Route path="/outsource/settings" component={OutsourceSettings} />
              <Route path="/outsource/rate-cards" component={OutsourceRateCards} />
              <Route path="/outsource/worklist" component={OutsourceWorklist} />
              <Route path="/outsource/reconciliation" component={OutsourceReconciliation} />
              <Route path="/outsource/ledger" component={OutsourceLedger} />
              <Route path="/outsource/dashboard" component={OutsourceDashboard} />
              <Route path="/samples" component={Samples} />
              <Route path="/scan-station" component={ScanStation} />
              <Route path="/report-delivery" component={ReportDelivery} />
              <Route path="/settings/radiology" component={RadiologySettings} />
              <Route path="/radiology/settings-center" component={RadiologySettingsCenter} />
              <Route path="/settings" component={Settings} />
              <Route path="/whatsapp-chatbot" component={WhatsAppChatbot} />
              <Route path="/system-update" component={SystemUpdate} />
              {portalLoaded && (window as any).SuperAdminPortal && (
                <Route path="/super-admin-portal/:rest*">
                  {() => {
                    const PortalComponent = (window as any).SuperAdminPortal;
                    return <PortalComponent />;
                  }}
                </Route>
              )}
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
