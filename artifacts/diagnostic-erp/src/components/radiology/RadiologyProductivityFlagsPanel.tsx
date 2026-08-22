import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ScanLine, Sparkles, BookOpen, Bot, Brain, Construction,
  GraduationCap, Keyboard,
} from "lucide-react";
import { isFeatureEnabled, setFeatureFlag } from "@/lib/staffSession";

/** Browser-local radiology workstation productivity flags (Settings → Radiology tab). */
export default function RadiologyProductivityFlagsPanel() {
  const [quickAdd, setQuickAdd] = useState(() => isFeatureEnabled("radiologyQuickAdd"));
  const [smartFormat, setSmartFormat] = useState(() => isFeatureEnabled("radiologySmartFormat"));
  const [previousReports, setPreviousReports] = useState(() => isFeatureEnabled("radiologyPreviousReports"));
  const [favorites, setFavorites] = useState(() => isFeatureEnabled("radiologyFavorites"));
  const [macros, setMacros] = useState(() => isFeatureEnabled("radiologyMacros"));
  const [measurements, setMeasurements] = useState(() => isFeatureEnabled("radiologyMeasurements"));
  const [aiAssistant, setAiAssistant] = useState(() => isFeatureEnabled("radiologyAiAssistant") !== false);

  // Phase 2D intelligence flags
  const [structuredFindings, setStructuredFindings] = useState(() => isFeatureEnabled("radiologyStructuredFindings"));
  const [impressionSync, setImpressionSync] = useState(() => isFeatureEnabled("radiologyImpressionSync"));
  const [conflictDetection, setConflictDetection] = useState(() => isFeatureEnabled("radiologyConflictDetection"));
  const [qualityChecker, setQualityChecker] = useState(() => isFeatureEnabled("radiologyQualityChecker"));
  const [smartImpression, setSmartImpression] = useState(() => isFeatureEnabled("radiologySmartImpression"));
  const [measurementLibrary, setMeasurementLibrary] = useState(() => isFeatureEnabled("radiologyMeasurementLibrary"));
  const [priorityEngine, setPriorityEngine] = useState(() => isFeatureEnabled("radiologyPriorityEngine"));
  const [comparison, setComparison] = useState(() => isFeatureEnabled("radiologyComparison"));
  const [favoritesPack, setFavoritesPack] = useState(() => isFeatureEnabled("radiologyFavoritesPack"));
  const [knowledgeBase, setKnowledgeBase] = useState(() => isFeatureEnabled("radiologyKnowledgeBase"));
  const [versionHistory, setVersionHistory] = useState(() => isFeatureEnabled("radiologyVersionHistory"));
  const [analytics, setAnalytics] = useState(() => isFeatureEnabled("radiologyAnalytics"));

  // Phase 3: Premium Radiology Workstation flags
  const [masterLibrary, setMasterLibrary] = useState(() => isFeatureEnabled("radiologyMasterLibrary"));
  const [oneClickReports, setOneClickReports] = useState(() => isFeatureEnabled("radiologyOneClickReports"));
  const [advancedMeasurements, setAdvancedMeasurements] = useState(() => isFeatureEnabled("radiologyAdvancedMeasurements"));
  const [aiHooks, setAiHooks] = useState(() => isFeatureEnabled("radiologyAiHooks"));
  // Chunk 2
  const [reportAssembler, setReportAssembler] = useState(() => isFeatureEnabled("radiologyReportAssembler"));
  const [qaGuard, setQAGuard] = useState(() => isFeatureEnabled("radiologyQAGuard"));
  const [finalizationDashboard, setFinalizationDashboard] = useState(() => isFeatureEnabled("radiologyFinalizationDashboard"));
  // Phase 4: Knowledge Platform
  const [knowledgePlatform, setKnowledgePlatform] = useState(() => isFeatureEnabled("radiologyKnowledgePlatform"));
  const [masterTemplates, setMasterTemplates] = useState(() => isFeatureEnabled("radiologyMasterTemplates"));
  const [personalLibrary, setPersonalLibrary] = useState(() => isFeatureEnabled("radiologyPersonalLibrary"));
  const [templatePacks, setTemplatePacks] = useState(() => isFeatureEnabled("radiologyTemplatePacks"));
  const [knowledgeBase_v2, setKnowledgeBase_v2] = useState(() => isFeatureEnabled("radiologyKnowledgeBase_v2"));
  const [signOffProfiles, setSignOffProfiles] = useState(() => isFeatureEnabled("radiologySignOffProfiles"));
  const [templateAnalytics, setTemplateAnalytics] = useState(() => isFeatureEnabled("radiologyTemplateAnalytics"));
  // Phase 5: Structured Smart Reporting Engine
  const [smartFindings_v2, setSmartFindings_v2] = useState(() => isFeatureEnabled("radiologySmartFindings_v2"));
  const [impressionRules, setImpressionRules] = useState(() => isFeatureEnabled("radiologyImpressionRules"));
  const [favoriteFindingSets, setFavoriteFindingSets] = useState(() => isFeatureEnabled("radiologyFavoriteFindingSets"));
  const [smartAnalytics, setSmartAnalytics] = useState(() => isFeatureEnabled("radiologySmartAnalytics"));
  // Phase 6: Multi-AI Copilot
  const [aiCopilot, setAiCopilot] = useState(() => isFeatureEnabled("radiologyAICopilot"));
  const [multiAI, setMultiAI] = useState(() => isFeatureEnabled("radiologyMultiAI"));
  const [imageReview, setImageReview] = useState(() => isFeatureEnabled("radiologyImageReview"));
  const [differentialDiagnosis, setDifferentialDiagnosis] = useState(() => isFeatureEnabled("radiologyDifferentialDiagnosis"));
  const [qualityCheck, setQualityCheck] = useState(() => isFeatureEnabled("radiologyQualityCheck"));
  const [comparePrevious, setComparePrevious] = useState(() => isFeatureEnabled("radiologyComparePrevious"));
  const [promptManager, setPromptManager] = useState(() => isFeatureEnabled("radiologyPromptManager"));
  const [followUp, setFollowUp] = useState(() => isFeatureEnabled("radiologyFollowUp"));
  const [languagePolish, setLanguagePolish] = useState(() => isFeatureEnabled("radiologyLanguagePolish"));

  // Phase 7A: Advanced Multi-AI Radiology Assistant
  const [promptManager_v2, setPromptManager_v2] = useState(() => isFeatureEnabled("radiologyPromptManager_v2"));
  const [imageReviewAssistant, setImageReviewAssistant] = useState(() => isFeatureEnabled("radiologyImageReviewAssistant"));
  const [aiComparison, setAiComparison] = useState(() => isFeatureEnabled("radiologyAIComparison"));
  const [missedFindingDetector, setMissedFindingDetector] = useState(() => isFeatureEnabled("radiologyMissedFindingDetector"));
  const [providerRouting, setProviderRouting] = useState(() => isFeatureEnabled("radiologyProviderRouting"));
  const [providerFallback, setProviderFallback] = useState(() => isFeatureEnabled("radiologyProviderFallback"));
  // Phase 8: DICOM-Aware Radiology Copilot + Teaching Files
  const [priorComparison, setPriorComparison] = useState(() => isFeatureEnabled("radiologyPriorComparison"));
  const [measurementTracker, setMeasurementTracker] = useState(() => isFeatureEnabled("radiologyMeasurementTracker"));
  const [smartImpression_v2, setSmartImpression_v2] = useState(() => isFeatureEnabled("radiologySmartImpression_v2"));
  const [consistencyChecker, setConsistencyChecker] = useState(() => isFeatureEnabled("radiologyConsistencyChecker"));
  const [followupAssistant, setFollowupAssistant] = useState(() => isFeatureEnabled("radiologyFollowupAssistant"));
  const [dicomMetadataAssistant, setDicomMetadataAssistant] = useState(() => isFeatureEnabled("radiologyDicomMetadataAssistant"));
  const [structuredReporting, setStructuredReporting] = useState(() => isFeatureEnabled("radiologyStructuredReporting"));
  const [teachingMode, setTeachingMode] = useState(() => isFeatureEnabled("radiologyTeachingMode"));
  const [teachingFiles, setTeachingFiles] = useState(() => isFeatureEnabled("radiologyTeachingFiles"));
  const [teachingAI, setTeachingAI] = useState(() => isFeatureEnabled("radiologyTeachingAI"));
  const [teachingCollections, setTeachingCollections] = useState(() => isFeatureEnabled("radiologyTeachingCollections"));
  const [teachingPresentation, setTeachingPresentation] = useState(() => isFeatureEnabled("radiologyTeachingPresentation"));
  const [teachingResearch, setTeachingResearch] = useState(() => isFeatureEnabled("radiologyTeachingResearch"));
  // Phase 10: DICOM Image Intelligence Platform
  const [dicomImageIntelligence, setDicomImageIntelligence] = useState(() => isFeatureEnabled("dicomImageIntelligence"));
  const [lesionTracking, setLesionTracking] = useState(() => isFeatureEnabled("lesionTracking"));
  const [changeDetection, setChangeDetection] = useState(() => isFeatureEnabled("changeDetection"));
  const [spineIntelligence, setSpineIntelligence] = useState(() => isFeatureEnabled("spineIntelligence"));
  const [brainIntelligence, setBrainIntelligence] = useState(() => isFeatureEnabled("brainIntelligence"));
  const [tumorFollowup, setTumorFollowup] = useState(() => isFeatureEnabled("tumorFollowup"));
  const [imageAnnotations, setImageAnnotations] = useState(() => isFeatureEnabled("imageAnnotations"));
  const [researchDatabase, setResearchDatabase] = useState(() => isFeatureEnabled("researchDatabase"));
  const [teachingGenerator, setTeachingGenerator] = useState(() => isFeatureEnabled("teachingGenerator"));
  const [multiAIImageReview, setMultiAIImageReview] = useState(() => isFeatureEnabled("multiAIImageReview"));
  const [measurementAssistantFlag, setMeasurementAssistantFlag] = useState(() => isFeatureEnabled("measurementAssistant"));
  const [confidenceVisualization, setConfidenceVisualization] = useState(() => isFeatureEnabled("confidenceVisualization"));
  const [ollamaSupport, setOllamaSupport] = useState(() => isFeatureEnabled("ollamaSupport"));
  const [caseOfMonth, setCaseOfMonth] = useState(() => isFeatureEnabled("caseOfMonth"));
  const [annotationLayer, setAnnotationLayer] = useState(() => isFeatureEnabled("annotationLayer"));

  // Phase 9: Radiology Memory + Context Engine
  const [memoryEngine, setMemoryEngine] = useState(() => isFeatureEnabled("radiologyMemoryEngine"));
  const [styleLearning, setStyleLearning] = useState(() => isFeatureEnabled("radiologyStyleLearning"));
  const [impressionMemory, setImpressionMemory] = useState(() => isFeatureEnabled("radiologyImpressionMemory"));
  const [measurementMemory, setMeasurementMemory] = useState(() => isFeatureEnabled("radiologyMeasurementMemory"));
  const [decisionMemory, setDecisionMemory] = useState(() => isFeatureEnabled("radiologyDecisionMemory"));
  const [feedbackLoop, setFeedbackLoop] = useState(() => isFeatureEnabled("radiologyFeedbackLoop"));
  const [caseMemory, setCaseMemory] = useState(() => isFeatureEnabled("radiologyCaseMemory"));
  const [analyticsMemory, setAnalyticsMemory] = useState(() => isFeatureEnabled("radiologyAnalyticsMemory"));
  const [macroEngine, setMacroEngine] = useState(() => isFeatureEnabled("radiologyMacroEngine"));

  const toggles = [
    { id: "radiologyQuickAdd", label: "Quick Add Buttons", desc: "Alt+1-6 shortcut buttons for instant insertion of common findings", value: quickAdd, set: setQuickAdd },
    { id: "radiologySmartFormat", label: "Smart Format Templates", desc: "Shift+Alt+1-5 shortcuts for full study templates", value: smartFormat, set: setSmartFormat },
    { id: "radiologyPreviousReports", label: "Previous Reports Lookup", desc: "Compare and reference prior patient imaging", value: previousReports, set: setPreviousReports },
    { id: "radiologyFavorites", label: "Favorites & Templates", desc: "Personal and shared saved findings", value: favorites, set: setFavorites },
    { id: "radiologyMacros", label: "Macro Engine", desc: "Type /fl1, /faz1, /disc etc. to expand into full text", value: macros, set: setMacros },
    { id: "radiologyMeasurements", label: "Measurements Panel", desc: "Visual measurement and annotation tools", value: measurements, set: setMeasurements },
    { id: "radiologyAiAssistant", label: "AI Draft Assistant", desc: "Gemini-powered impression generation (disabled for sensitive reporting)", value: aiAssistant, set: setAiAssistant },
  ];

  const intelligenceToggles = [
    { id: "radiologyStructuredFindings", label: "Structured Findings", desc: "Insert paired findings + impression blocks", value: structuredFindings, set: setStructuredFindings },
    { id: "radiologyImpressionSync", label: "Impression Auto-Sync", desc: "Auto-suggest impressions as you type findings", value: impressionSync, set: setImpressionSync },
    { id: "radiologyConflictDetection", label: "Conflict Detection", desc: "Warn when contradictory findings are present", value: conflictDetection, set: setConflictDetection },
    { id: "radiologyQualityChecker", label: "Quality Checker", desc: "Pre-finalize checks: placeholders, duplicates, missing impression", value: qualityChecker, set: setQualityChecker },
    { id: "radiologySmartImpression", label: "Smart Impression", desc: "Combine multiple findings into coherent impression", value: smartImpression, set: setSmartImpression },
    { id: "radiologyMeasurementLibrary", label: "Measurement Library", desc: "One-click measurement templates (canal, lesion, BPD, etc.)", value: measurementLibrary, set: setMeasurementLibrary },
    { id: "radiologyPriorityEngine", label: "Priority Engine", desc: "Auto-classify: NORMAL / MINOR / SIGNIFICANT / CRITICAL", value: priorityEngine, set: setPriorityEngine },
    { id: "radiologyComparison", label: "Previous Report Comparison", desc: "Auto-detect changes vs prior study", value: comparison, set: setComparison },
    { id: "radiologyFavoritesPack", label: "Favorites Report Packs", desc: "Save entire report (findings + impression) for reuse", value: favoritesPack, set: setFavoritesPack },
    { id: "radiologyKnowledgeBase", label: "Knowledge Base", desc: "Searchable teaching library with tags", value: knowledgeBase, set: setKnowledgeBase },
    { id: "radiologyVersionHistory", label: "Version History", desc: "Track edits, timestamps, and restore drafts", value: versionHistory, set: setVersionHistory },
    { id: "radiologyAnalytics", label: "Reporting Analytics", desc: "Per-radiologist stats and template usage", value: analytics, set: setAnalytics },
  ];

  const advancedToggles = [
    { id: "radiologyMasterLibrary", label: "Master Template Library", desc: "Locked Dr. Sugandha master templates with one-click variants", value: masterLibrary, set: setMasterLibrary },
    { id: "radiologyOneClickReports", label: "One-Click Complete Reports", desc: "Instant full report generation from master variants", value: oneClickReports, set: setOneClickReports },
    { id: "radiologyAdvancedMeasurements", label: "Advanced Measurement Library", desc: "One-click measurement templates with normal ranges", value: advancedMeasurements, set: setAdvancedMeasurements },
    { id: "radiologyAiHooks", label: "AI-Ready Infrastructure", desc: "Future hooks for voice dictation, AI drafting, and AI comparison", value: aiHooks, set: setAiHooks },
    { id: "radiologyReportAssembler", label: "Report Assembler", desc: "Multi-template selection with auto-combination and deduplication", value: reportAssembler, set: setReportAssembler },
    { id: "radiologyQAGuard", label: "QA Guard", desc: "Comprehensive pre-finalize checks with score and warnings", value: qaGuard, set: setQAGuard },
    { id: "radiologyFinalizationDashboard", label: "Finalization Dashboard", desc: "Final checkpoint before signing with quality score and alerts", value: finalizationDashboard, set: setFinalizationDashboard },
  ];

  const knowledgePlatformToggles = [
    { id: "radiologyKnowledgePlatform", label: "Knowledge Platform", desc: "Enable all Phase 4 knowledge features", value: knowledgePlatform, set: setKnowledgePlatform },
    { id: "radiologyMasterTemplates", label: "Master Templates", desc: "DB-backed master templates with version control (Dr. Sugandha / Dr. Abinash / Care / Hope)", value: masterTemplates, set: setMasterTemplates },
    { id: "radiologyPersonalLibrary", label: "Personal Template Library", desc: "Save, edit, and organize your own templates with folders", value: personalLibrary, set: setPersonalLibrary },
    { id: "radiologyTemplatePacks", label: "Template Packs", desc: "Create and apply reusable multi-template packs", value: templatePacks, set: setTemplatePacks },
    { id: "radiologyKnowledgeBase_v2", label: "Knowledge Base v2", desc: "Searchable DB-backed articles with classification systems", value: knowledgeBase_v2, set: setKnowledgeBase_v2 },
    { id: "radiologySignOffProfiles", label: "Sign-Off Profiles", desc: "Per-radiologist default settings and preferences", value: signOffProfiles, set: setSignOffProfiles },
    { id: "radiologyTemplateAnalytics", label: "Template Analytics", desc: "Usage tracking and per-radiologist template statistics", value: templateAnalytics, set: setTemplateAnalytics },
  ];

  const aiCopilotToggles = [
    { id: "radiologyAICopilot", label: "AI Copilot Panel", desc: "Unified AI copilot panel with draft generation, differential, follow-up, quality check", value: aiCopilot, set: setAiCopilot },
    { id: "radiologyMultiAI", label: "Multi-AI Provider Routing", desc: "Route different tasks to different AI providers (OpenAI, Gemini, Claude, Ollama, OpenRouter)", value: multiAI, set: setMultiAI },
    { id: "radiologyDifferentialDiagnosis", label: "Differential Diagnosis", desc: "Structured differential diagnosis suggestions with confidence levels", value: differentialDiagnosis, set: setDifferentialDiagnosis },
    { id: "radiologyFollowUp", label: "Follow-Up Recommendations", desc: "Condition-based follow-up and surveillance recommendations", value: followUp, set: setFollowUp },
    { id: "radiologyImageReview", label: "Image Review Assistant", desc: "Vision-capable AI secondary review and missed finding suggestions", value: imageReview, set: setImageReview },
    { id: "radiologyComparePrevious", label: "Previous Report Comparison", desc: "Side-by-side comparison with new findings and progression highlights", value: comparePrevious, set: setComparePrevious },
    { id: "radiologyQualityCheck", label: "AI Quality Checker", desc: "Detect missing impression, measurements, contradictions, and errors", value: qualityCheck, set: setQualityCheck },
    { id: "radiologyLanguagePolish", label: "Language Polish & Formatting", desc: "Refine report language, grammar, and formatting without changing medical content", value: languagePolish, set: setLanguagePolish },
    { id: "radiologyPromptManager", label: "Prompt Manager", desc: "Admin-editable prompt library with version history and testing", value: promptManager, set: setPromptManager },
  ];

  const phase7aToggles = [
    { id: "radiologyPromptManager_v2", label: "AI Prompt Manager v2", desc: "Enterprise prompt library with 9 prompt types per category, versioning, doctor-specific libraries, and JSON import/export", value: promptManager_v2, set: setPromptManager_v2 },
    { id: "radiologyImageReviewAssistant", label: "Image Review Assistant", desc: "Vision-capable AI secondary review with structured findings, differential, missed findings, and confidence scores", value: imageReviewAssistant, set: setImageReviewAssistant },
    { id: "radiologyAIComparison", label: "AI Comparison Workspace", desc: "Run same prompt against multiple providers side-by-side with performance stats", value: aiComparison, set: setAiComparison },
    { id: "radiologyMissedFindingDetector", label: "Missed Finding Detector", desc: "Critical finding detection for MRI Brain, Spine, CT, Chest, and Abdomen", value: missedFindingDetector, set: setMissedFindingDetector },
    { id: "radiologyProviderRouting", label: "AI Provider Routing", desc: "Assign different AI providers to different radiology tasks (image review → Gemini, findings → GPT, etc.)", value: providerRouting, set: setProviderRouting },
    { id: "radiologyProviderFallback", label: "Provider Fallback", desc: "Configurable fallback chain when primary provider fails (Gemini → GPT → Claude)", value: providerFallback, set: setProviderFallback },
  ];

  const smartReportingToggles = [
    { id: "radiologySmartFindings_v2", label: "Smart Findings v2", desc: "Structured, deterministic findings builder for MRI Brain, Cervical/Lumbar Spine, USG Abdomen", value: smartFindings_v2, set: setSmartFindings_v2 },
    { id: "radiologyImpressionRules", label: "Impression Rules", desc: "Admin-editable rule-based impression generator", value: impressionRules, set: setImpressionRules },
    { id: "radiologyFavoriteFindingSets", label: "Favorite Finding Sets", desc: "Save and reuse common structured findings per user", value: favoriteFindingSets, set: setFavoriteFindingSets },
    { id: "radiologySmartAnalytics", label: "Smart Reporting Analytics", desc: "Track smart findings usage, report time, and builder statistics", value: smartAnalytics, set: setSmartAnalytics },
  ];

  const phase8Toggles = [
    { id: "radiologyPriorComparison", label: "Prior Study Auto-Fetch", desc: "Automatically search and display prior studies for the same patient, modality, and body part", value: priorComparison, set: setPriorComparison },
    { id: "radiologyMeasurementTracker", label: "Measurement Tracker", desc: "Track measurement history across studies with trend display and change detection", value: measurementTracker, set: setMeasurementTracker },
    { id: "radiologySmartImpression_v2", label: "Smart Impression Builder", desc: "Generate impression directly from findings with editable output", value: smartImpression_v2, set: setSmartImpression_v2 },
    { id: "radiologyConsistencyChecker", label: "Consistency Checker", desc: "Detect mismatches between findings and impression (side, level, measurements)", value: consistencyChecker, set: setConsistencyChecker },
    { id: "radiologyFollowupAssistant", label: "Follow-up Intelligence", desc: "Guideline-based follow-up suggestions for BI-RADS, TI-RADS, PI-RADS, etc.", value: followupAssistant, set: setFollowupAssistant },
    { id: "radiologyDicomMetadataAssistant", label: "DICOM Metadata Assistant", desc: "Auto-read DICOM metadata and generate technique section", value: dicomMetadataAssistant, set: setDicomMetadataAssistant },
    { id: "radiologyStructuredReporting", label: "Structured Reporting Engine", desc: "One-click templates for all major studies with AI-fillable sections", value: structuredReporting, set: setStructuredReporting },
    { id: "radiologyTeachingMode", label: "Teaching Mode", desc: "Educational explanations with WHY button and learning references", value: teachingMode, set: setTeachingMode },
    { id: "radiologyTeachingFiles", label: "Teaching Files Platform", desc: "Save, search, and organize anonymized teaching cases", value: teachingFiles, set: setTeachingFiles },
    { id: "radiologyTeachingAI", label: "AI Teaching Assistant", desc: "Generate teaching summaries, learning points, and exam questions", value: teachingAI, set: setTeachingAI },
    { id: "radiologyTeachingCollections", label: "Teaching Collections", desc: "Create and share curated case collections", value: teachingCollections, set: setTeachingCollections },
    { id: "radiologyTeachingPresentation", label: "Presentation Mode", desc: "Generate teaching slides, quizzes, and unknown cases", value: teachingPresentation, set: setTeachingPresentation },
    { id: "radiologyTeachingResearch", label: "Research Mode", desc: "Track research candidates, publications, and conference submissions", value: teachingResearch, set: setTeachingResearch },
  ];

  const phase10Toggles = [
    { id: "dicomImageIntelligence", label: "DICOM Image Intelligence (Master Switch)", desc: "Enable the Phase 10 DICOM Image Intelligence Platform. All sub-features still require individual toggles.", value: dicomImageIntelligence, set: setDicomImageIntelligence },
    { id: "lesionTracking", label: "Lesion Tracker", desc: "Longitudinal lesion monitoring — track lesions across studies with size, signal, and status trends", value: lesionTracking, set: setLesionTracking },
    { id: "changeDetection", label: "Smart Change Detector", desc: "Automatically detect interval changes: new lesions, growth, regression, haemorrhage evolution, edema, hydrocephalus", value: changeDetection, set: setChangeDetection },
    { id: "measurementAssistant", label: "Structured Measurement Assistant", desc: "Guided measurement entry for MRI Brain, MRI Spine, Breast, Thyroid, Liver, Kidney, Lung, Pelvis with normal ranges", value: measurementAssistantFlag, set: setMeasurementAssistantFlag },
    { id: "spineIntelligence", label: "Spine Intelligence (Phase 10B)", desc: "Automated disc grading, canal stenosis classification, neural foraminal narrowing — all OFF until Phase 10B builds", value: spineIntelligence, set: setSpineIntelligence },
    { id: "brainIntelligence", label: "Brain Intelligence (Phase 10B)", desc: "Fazekas scoring, atrophy grading, lesion load, white matter classification — all OFF until Phase 10B builds", value: brainIntelligence, set: setBrainIntelligence },
    { id: "tumorFollowup", label: "Tumor Follow-up Engine (Phase 10B)", desc: "RECIST-guided measurement tracking, treatment response assessment, volumetric analysis — all OFF until Phase 10B", value: tumorFollowup, set: setTumorFollowup },
    { id: "imageAnnotations", label: "Image Annotation Layer (Phase 10B)", desc: "Text annotations on DICOM images with report linking — OFF until Phase 10B builds", value: imageAnnotations, set: setImageAnnotations },
    { id: "multiAIImageReview", label: "Multi-AI Image Review (Phase 10C)", desc: "Parallel AI review across multiple providers for secondary opinion — OFF until Phase 10C builds", value: multiAIImageReview, set: setMultiAIImageReview },
    { id: "teachingGenerator", label: "Teaching Case Generator (Phase 10C)", desc: "Auto-generate teaching summaries and exam questions from cases — OFF until Phase 10C builds", value: teachingGenerator, set: setTeachingGenerator },
    { id: "researchDatabase", label: "Research Database (Phase 10C)", desc: "Case tagging, cohort building, and anonymized research export — OFF until Phase 10C builds", value: researchDatabase, set: setResearchDatabase },
    { id: "caseOfMonth", label: "Case of the Month (Phase 10C)", desc: "Editorial workflow for selecting and publishing monthly teaching cases — OFF until Phase 10C builds", value: caseOfMonth, set: setCaseOfMonth },
    { id: "confidenceVisualization", label: "AI Confidence Visualization (Phase 10C)", desc: "Show confidence scores as colour-coded bars on every AI suggestion — OFF until Phase 10C builds", value: confidenceVisualization, set: setConfidenceVisualization },
    { id: "ollamaSupport", label: "Ollama Local Models (Phase 10C)", desc: "Run privacy-preserving AI locally via Ollama — OFF until Phase 10C builds", value: ollamaSupport, set: setOllamaSupport },
    { id: "annotationLayer", label: "Report Annotation Layer (Phase 10C)", desc: "Highlight text in reports and link annotations to image coordinates — OFF until Phase 10C builds", value: annotationLayer, set: setAnnotationLayer },
  ];

  const phase9Toggles = [
    { id: "radiologyMemoryEngine", label: "Radiology Memory Engine", desc: "Persistent memory that learns reporting preferences over time (styles, phrases, measurements)", value: memoryEngine, set: setMemoryEngine },
    { id: "radiologyStyleLearning", label: "Style Learning", desc: "Learn preferred wording, impression style, formatting, and terminology per radiologist", value: styleLearning, set: setStyleLearning },
    { id: "radiologyImpressionMemory", label: "Impression Memory", desc: "Store approved impressions and suggest them when similar findings appear", value: impressionMemory, set: setImpressionMemory },
    { id: "radiologyMeasurementMemory", label: "Measurement Memory", desc: "Track measurement history across studies with trend graphs", value: measurementMemory, set: setMeasurementMemory },
    { id: "radiologyDecisionMemory", label: "Decision Memory", desc: "Track accepted, rejected, and edited AI suggestions to learn preferences", value: decisionMemory, set: setDecisionMemory },
    { id: "radiologyFeedbackLoop", label: "AI Feedback Loop", desc: "Useful / Not Useful / Partially Useful buttons for all AI suggestions", value: feedbackLoop, set: setFeedbackLoop },
    { id: "radiologyCaseMemory", label: "Case Memory Linking", desc: "Connect current report to teaching files, research cases, and prior reports", value: caseMemory, set: setCaseMemory },
    { id: "radiologyAnalyticsMemory", label: "Personal Analytics", desc: "Dr Sugandha dashboard with most used templates, phrases, and time saved", value: analyticsMemory, set: setAnalyticsMemory },
    { id: "radiologyMacroEngine", label: "Personal Macro Engine", desc: "Shortcuts like /normalbrain, /l4l5disc, /fazekas2 for instant insertion", value: macroEngine, set: setMacroEngine },
  ];

  const [showExperimentalFlags, setShowExperimentalFlags] = useState(false);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="rounded-xl border bg-card border-card-border p-4 space-y-1">
        <h2 className="font-bold text-lg flex items-center gap-2"><ScanLine size={18} /> Device productivity flags</h2>
        <p className="text-sm text-muted-foreground">
          Browser-local toggles for this workstation only — not clinic-wide server Feature Flags or PACS settings.
          For PACS, viewers, MWL, and report style, use the other tabs in Settings → Radiology.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          {toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-100">Experimental / roadmap toggles</h3>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80 mt-1">
              Dozens of browser-local flags from earlier roadmap phases. Many are unwired or partial — they do not replace Radiology Settings Center or server Feature Flags.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setShowExperimentalFlags((v) => !v)}>
            {showExperimentalFlags ? "Hide experimental" : "Show experimental"}
          </Button>
        </div>
        {showExperimentalFlags && (
          <div className="space-y-6 pt-1">
      {/* Phase 3: Advanced Productivity */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Sparkles size={16} /> Advanced Productivity</h2>
          <p className="text-sm text-muted-foreground mt-1">Premium workstation features: master templates, one-click reports, advanced measurements, and AI-ready infrastructure.</p>
        </div>
        <div className="space-y-2">
          {advancedToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 4: Radiology Knowledge Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><BookOpen size={16} /> Radiology Knowledge Platform</h2>
          <p className="text-sm text-muted-foreground mt-1">Database-backed master templates, personal libraries, knowledge articles, version control, and analytics.</p>
        </div>
        <div className="space-y-2">
          {knowledgePlatformToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 6: AI Copilot Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Bot size={16} /> AI Copilot Platform</h2>
          <p className="text-sm text-muted-foreground mt-1">Multi-AI provider copilot for radiology. Supports OpenAI, Gemini, Claude, Ollama, OpenRouter. All AI outputs are editable and require radiologist review.</p>
        </div>
        <div className="space-y-2">
          {aiCopilotToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 7A: Advanced Multi-AI Radiology Assistant */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Advanced Multi-AI Radiology Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1">Enterprise-grade prompt management, multi-provider task routing, AI comparison workspace, image review, missed finding detection, and provider fallback. All OFF by default.</p>
        </div>
        <div className="space-y-2">
          {phase7aToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 8: DICOM-Aware Radiology Copilot + Teaching Files */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><GraduationCap size={16} /> DICOM Radiology Copilot + Teaching</h2>
          <p className="text-sm text-muted-foreground mt-1">Enterprise RIS/PACS-integrated copilot with prior study comparison, measurement tracking, structured reporting, teaching files, and research mode. All OFF by default.</p>
        </div>
        <div className="space-y-2">
          {phase8Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 10: DICOM Image Intelligence Platform */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> DICOM Image Intelligence Platform (Phase 10)</h2>
          <p className="text-sm text-muted-foreground mt-1">Lesion Tracker, Change Detector, Measurement Assistant, Organ Intelligence, and AI Research Tools. All OFF by default. Phase 10B/C flags are placeholders — activate only when that phase ships. Radiologist is always final authority.</p>
        </div>
        <div className="space-y-2">
          {phase10Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Ollama Local Model config is configured in ONE place — Radiology
          Settings → AI & Templates → Local AI (POST /api/clinic-settings/ollama).
          The old duplicate card here wrote a different, partial path and is
          removed to avoid two competing save flows. */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="font-bold text-lg flex items-center gap-2">🦙 Ollama Local Model Configuration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configured in <strong>Radiology Settings → AI &amp; Templates → Local AI</strong> — the single place for the
          Ollama endpoint (primary/fallback), model, timeout, and enable toggle.
        </p>
      </div>

      {/* Phase 9: Radiology Memory + Context Engine */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Radiology Memory + Context Engine</h2>
          <p className="text-sm text-muted-foreground mt-1">Learns Dr Sugandha's reporting preferences over time. All features OFF by default. Radiologist is always final authority.</p>
        </div>
        <div className="space-y-2">
          {phase9Toggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 5: Structured Smart Reporting Engine */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Construction size={16} /> Structured Smart Reporting</h2>
          <p className="text-sm text-muted-foreground mt-1">Deterministic, rules-based text generation for MRI Brain, Cervical/Lumbar Spine, and USG Abdomen. All generated text is editable and auditable. No AI.</p>
        </div>
        <div className="space-y-2">
          {smartReportingToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

      {/* Phase 2D Intelligence Layer */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Brain size={16} /> Radiology Intelligence Layer</h2>
          <p className="text-sm text-muted-foreground mt-1">Advanced client-side tools for quality, structure, and efficiency. All run locally with no external API calls.</p>
        </div>
        <div className="space-y-2">
          {intelligenceToggles.map((t) => (
            <label key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="pr-4">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">{t.desc}</div>
              </div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${t.value ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${t.value ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={t.value} onChange={() => {
                const next = !t.value;
                t.set(next);
                setFeatureFlag(t.id, next);
              }} />
            </label>
          ))}
        </div>
      </div>

          </div>
        )}
      </div>

      {/* Keyboard shortcuts reference */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-bold text-lg flex items-center gap-2"><Keyboard size={16} /> Keyboard Shortcuts</h2>
          <p className="text-sm text-muted-foreground mt-1">Quick reference for the radiologist workspace.</p>
        </div>
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Quick Add Buttons</span>
            <span className="font-mono text-xs text-muted-foreground">Alt + 1-6</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Smart Format Templates</span>
            <span className="font-mono text-xs text-muted-foreground">Shift + Alt + 1-5</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Macro Expansion</span>
            <span className="font-mono text-xs text-muted-foreground">/shortcut + Space</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Favorites Panel</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + F</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Previous Reports</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + P</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20">
            <span className="font-medium">Measurements Panel</span>
            <span className="font-mono text-xs text-muted-foreground">Ctrl + Shift + M</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
