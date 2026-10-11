"use client";

import { BrandHeader } from "@/components/ui/BrandHeader";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  analyzeReport,
  getBrowserSession,
  getParticipantNotifications,
  logoutBrowserSession,
  prepareReport,
  saveParticipantFollowUpResponse,
  submitReport,
  type ParticipantNotification,
  type ParticipantFollowUpResponse,
} from "@/lib/frontend-api";
import { MicHero } from "@/components/ui/MicHero";
import { useRecorder } from "@/hooks/useRecorder";
import {
  ParticipantReportReview,
  type EditablePreparedSymptom,
} from "@/components/ui/ParticipantReportReview";
import { SideTabs, type Tab } from "@/components/ui/SideTabs";
import type { Language } from "@/lib/types";
import type {
  AnalyzeResponse,
  PrepareReportResponse,
  SubmitReportRequest,
  SubmitReportResponse,
} from "@/types/reports";

type Onboard = "language" | "done";
type Flow = "idle" | "review" | "done";

// Fictional placeholder for the demo
const STUDY_TEAM_PHONE = "[study team number]";

const langOptions: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文（普通话）" },
  { code: "vi", label: "Tiếng Việt" },
];
const dateLocales: Record<Language, string> = {
  en: "en-US",
  es: "es",
  zh: "zh-CN",
  vi: "vi-VN",
};

function formatNotificationTimestamp(value: string, language: Language) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(dateLocales[language], { dateStyle: "medium", timeStyle: "short" });
}

const copy: Record<Language, {
  tabs: Record<Tab, string>;
  next: string;
  howFeeling: string;
  tap: string;
  listening: string;
  transcribing: string;
  transcriptInstruction: string;
  confirmTranscript: string;
  rerecord: string;
  typeInstead: string;
  typePlaceholder: string;
  heard: string;
  isRight: string;
  yes: string;
  change: string;
  saved: string;
  safetyTitle: string;
  safety: string;
  noDiagnose: string;
  again: string;
  profileTitle: string;
  language: string;
  pastTitle: string;
  pastEmpty: string;
  savedTag: string;
  chatTitle: string;
  careTeam: string;
  chatEmpty: string;
  chatDemoNotice: string;
  notificationsLoading: string;
  notificationsError: string;
  retry: string;
  appointmentScheduled: string;
  scheduleLater: string;
  appointmentReported: string;
  laterReported: string;
  responseSaving: string;
  responseSaveError: string;
  openChat: string;
  closeChat: string;
  notificationCount: string;
  reviewTitle: string;
  translatedReport: string;
  summary: string;
  extractedSymptoms: string;
  symptom: string;
  selectSymptom: string;
  participantDescription: string;
  descriptionError: string;
  reportedIntensity: string;
  intensityHint: string;
  intensityError: string;
  onsetDate: string;
  onsetText: string;
  ongoing: string;
  ongoingCandidate: string;
  unknown: string;
  ongoingYes: string;
  ongoingNo: string;
  noSymptoms: string;
  verified: string;
  unverified: string;
  manualReview: string;
  analysisClarification: string;
  reviewConfirmation: string;
  submitReport: string;
  submittingReport: string;
  cancelReview: string;
  authLink: string;
  analyzing: string;
  preparing: string;
  historyNotConnected: string;
  reportId: string;
  signOut: string;
  signingOut: string;
  signOutError: string;
  checkingSession: string;
  sessionRequired: string;
  sessionExpired: string;
}> = {
  en: {
    tabs: { home: "Home", profile: "Profile", past: "Past reports" },
    next: "Next",
    howFeeling: "How are you feeling today?",
    tap: "Tap and talk",
    listening: "Listening… tap to stop",
    transcribing: "Transcribing your recording…",
    transcriptInstruction: "Review and edit the transcript. It will not be analyzed until you confirm.",
    confirmTranscript: "Use this transcript and continue",
    rerecord: "Record again",
    typeInstead: "Type instead",
    typePlaceholder: "Write how you are feeling",
    heard: "I heard:",
    isRight: "Is that right?",
    yes: "Yes, that's right",
    change: "No, let me change it",
    saved: "Your report was submitted to your study team for review.",
    safetyTitle: "If you feel very unwell",
    safety: `Please call your study team at ${STUDY_TEAM_PHONE} now. If it's an emergency, call 911.`,
    noDiagnose: "This app does not diagnose. It only records what you tell it.",
    again: "Start a new report",
    profileTitle: "Your profile",
    language: "Language",
    pastTitle: "Past reports",
    pastEmpty: "No past reports yet.",
    savedTag: "✓ Saved",
    chatTitle: "Notification Center",
    careTeam: "Your doctor or coordinator",
    chatEmpty: "No notifications yet.",
    chatDemoNotice: "In-app messages are not emergency alerts.",
    notificationsLoading: "Loading notifications…",
    notificationsError: "Notifications could not be loaded.",
    retry: "Try again",
    appointmentScheduled: "Appointment Scheduled",
    scheduleLater: "Understood, Will Schedule Appointment Later",
    appointmentReported: "You reported that you scheduled a follow-up appointment. Symora did not book an appointment.",
    laterReported: "You asked to be reminded to schedule your follow-up appointment.",
    responseSaving: "Saving your response…",
    responseSaveError: "Your response could not be saved. Please try again.",
    openChat: "Open Notification Center",
    closeChat: "Close Notification Center",
    notificationCount: "notifications",
    reviewTitle: "Review your report",
    translatedReport: "English translation",
    summary: "Analysis summary",
    extractedSymptoms: "Extracted symptoms",
    symptom: "Symptom",
    selectSymptom: "Select a symptom from the study catalog",
    participantDescription: "Description in your words",
    descriptionError: "Please keep the description to 2,000 characters or fewer.",
    reportedIntensity: "Intensity you reported (0–10)",
    intensityHint: "Leave blank if you did not say a number.",
    intensityError: "Intensity must be a whole number from 0 to 10.",
    onsetDate: "Start date (optional)",
    onsetText: "Analysis timing",
    ongoing: "Is this still happening?",
    ongoingCandidate: "Analysis suggestion",
    unknown: "Not sure / not reported",
    ongoingYes: "Yes",
    ongoingNo: "No",
    noSymptoms: "No symptoms were extracted. Do not add any that you did not report.",
    verified: "This detail appears in your original report.",
    unverified: "Please check this detail against your original report.",
    manualReview: "Please check each symptom and its original wording carefully.",
    analysisClarification: "Analysis suggested question (review only)",
    reviewConfirmation: "I reviewed this report and confirm it accurately reflects what I reported.",
    submitReport: "Confirm and submit report",
    submittingReport: "Submitting…",
    cancelReview: "Edit my report",
    authLink: "Open participant sign-in",
    analyzing: "Analyzing your report…",
    preparing: "Preparing symptom details…",
    historyNotConnected: "Past report history is not available from the current participant API.",
    reportId: "Report reference",
    signOut: "Sign out",
    signingOut: "Signing out…",
    checkingSession: "Checking session…",
    sessionRequired: "Sign in with a participant account to continue.",
    sessionExpired: "Your session has expired. Sign in again to continue.",
    signOutError: "Sign out failed. Please try again.",
  },
  es: {
    tabs: { home: "Inicio", profile: "Perfil", past: "Reportes anteriores" },
    next: "Siguiente",
    howFeeling: "¿Cómo te sientes hoy?",
    tap: "Toca y habla",
    listening: "Escuchando… toca para detener",
    transcribing: "Transcribiendo tu grabación…",
    transcriptInstruction: "Revisa y edita la transcripción. No se analizará hasta que la confirmes.",
    confirmTranscript: "Usar esta transcripción y continuar",
    rerecord: "Grabar de nuevo",
    typeInstead: "Escribir en su lugar",
    typePlaceholder: "Escribe cómo te sientes",
    heard: "Escuché:",
    isRight: "¿Es correcto?",
    yes: "Sí, es correcto",
    change: "No, quiero cambiarlo",
    saved: "Tu reporte se envió a tu equipo del estudio para que lo revise.",
    safetyTitle: "Si te sientes muy mal",
    safety: `Llama a tu equipo del estudio al ${STUDY_TEAM_PHONE} ahora. Si es una emergencia, llama al 911.`,
    noDiagnose: "Esta app no diagnostica. Solo registra lo que tú le dices.",
    again: "Iniciar un nuevo reporte",
    profileTitle: "Tu perfil",
    language: "Idioma",
    pastTitle: "Reportes anteriores",
    pastEmpty: "Aún no hay reportes anteriores.",
    savedTag: "✓ Guardado",
    chatTitle: "Centro de notificaciones",
    careTeam: "Tu médico o coordinador",
    chatEmpty: "Aún no hay notificaciones.",
    chatDemoNotice: "Los mensajes de la aplicación no son alertas de emergencia.",
    notificationsLoading: "Cargando notificaciones…",
    notificationsError: "No se pudieron cargar las notificaciones.",
    retry: "Intentar de nuevo",
    appointmentScheduled: "Cita programada",
    scheduleLater: "Entendido, programaré la cita más adelante",
    appointmentReported: "Indicaste que programaste una cita de seguimiento. Symora no reservó ninguna cita.",
    laterReported: "Pediste que te recordemos programar tu cita de seguimiento.",
    responseSaving: "Guardando tu respuesta…",
    responseSaveError: "No se pudo guardar tu respuesta. Inténtalo de nuevo.",
    openChat: "Abrir el centro de notificaciones",
    closeChat: "Cerrar el centro de notificaciones",
    notificationCount: "notificaciones",
    reviewTitle: "Revisa tu reporte",
    translatedReport: "Traducción al inglés",
    summary: "Resumen del análisis",
    extractedSymptoms: "Síntomas extraídos",
    symptom: "Síntoma",
    selectSymptom: "Selecciona un síntoma del catálogo del estudio",
    participantDescription: "Descripción con tus palabras",
    descriptionError: "La descripción debe tener 2.000 caracteres o menos.",
    reportedIntensity: "Intensidad que reportaste (0–10)",
    intensityHint: "Déjalo en blanco si no dijiste un número.",
    intensityError: "La intensidad debe ser un número entero del 0 al 10.",
    onsetDate: "Fecha de inicio (opcional)",
    onsetText: "Tiempo según el análisis",
    ongoing: "¿Sigue ocurriendo?",
    ongoingCandidate: "Sugerencia del análisis",
    unknown: "No sé / no lo reporté",
    ongoingYes: "Sí",
    ongoingNo: "No",
    noSymptoms: "No se extrajeron síntomas. No agregues ninguno que no hayas reportado.",
    verified: "Este detalle aparece en tu reporte original.",
    unverified: "Revisa este detalle con respecto a tu reporte original.",
    manualReview: "Revisa cuidadosamente cada síntoma y su redacción original.",
    analysisClarification: "Pregunta sugerida por el análisis (solo para revisar)",
    reviewConfirmation: "Revisé este reporte y confirmo que refleja con precisión lo que reporté.",
    submitReport: "Confirmar y enviar reporte",
    submittingReport: "Enviando…",
    cancelReview: "Editar mi reporte",
    authLink: "Abrir inicio de sesión del participante",
    analyzing: "Analizando tu reporte…",
    preparing: "Preparando los síntomas…",
    historyNotConnected: "El API actual para participantes no permite consultar reportes anteriores.",
    reportId: "Referencia del reporte",
    signOut: "Cerrar sesión",
    signingOut: "Cerrando sesión…",
    checkingSession: "Verificando sesión…",
    sessionRequired: "Inicia sesión con una cuenta de participante para continuar.",
    sessionExpired: "Tu sesión venció. Inicia sesión otra vez para continuar.",
    signOutError: "No se pudo cerrar la sesión. Inténtalo de nuevo.",
  },
  zh: {
    tabs: { home: "首页", profile: "我的资料", past: "以往报告" },
    next: "下一步",
    howFeeling: "您今天感觉怎么样？",
    tap: "点击并说话",
    listening: "正在聆听…点击停止",
    transcribing: "正在转写录音…",
    transcriptInstruction: "请检查并编辑转写内容。确认后才会进行分析。",
    confirmTranscript: "使用此转写内容并继续",
    rerecord: "重新录音",
    typeInstead: "改为打字",
    typePlaceholder: "请写下您的感受",
    heard: "我听到的是：",
    isRight: "对吗？",
    yes: "对，没错",
    change: "不对，我要修改",
    saved: "您的报告已提交，供研究团队查看。",
    safetyTitle: "如果您感觉非常不舒服",
    safety: `请立即致电您的研究团队 ${STUDY_TEAM_PHONE}。如果情况紧急，请拨打911。`,
    noDiagnose: "本应用不做诊断，只记录您所说的内容。",
    again: "开始新的报告",
    profileTitle: "您的资料",
    language: "语言",
    pastTitle: "以往报告",
    pastEmpty: "目前还没有以往的报告。",
    savedTag: "✓ 已保存",
    chatTitle: "通知中心",
    careTeam: "您的医生或协调员",
    chatEmpty: "暂无通知。",
    chatDemoNotice: "应用内消息不是紧急警报。",
    notificationsLoading: "正在加载通知…",
    notificationsError: "无法加载通知。",
    retry: "重试",
    appointmentScheduled: "已安排预约",
    scheduleLater: "知道了，稍后安排预约",
    appointmentReported: "您表示已安排后续预约。Symora 并未为您预约。",
    laterReported: "您已请求提醒安排后续预约。",
    responseSaving: "正在保存您的回复…",
    responseSaveError: "无法保存您的回复。请重试。",
    openChat: "打开通知中心",
    closeChat: "关闭通知中心",
    notificationCount: "条通知",
    reviewTitle: "请检查您的报告",
    translatedReport: "英文翻译",
    summary: "分析摘要",
    extractedSymptoms: "提取的症状",
    symptom: "症状",
    selectSymptom: "请从研究目录中选择症状",
    participantDescription: "用您的话描述",
    descriptionError: "描述不能超过2,000个字符。",
    reportedIntensity: "您报告的程度（0–10）",
    intensityHint: "如果您没有说数字，请留空。",
    intensityError: "程度必须是0到10之间的整数。",
    onsetDate: "开始日期（可选）",
    onsetText: "分析中的时间描述",
    ongoing: "这种情况仍在发生吗？",
    ongoingCandidate: "分析建议",
    unknown: "不确定 / 未报告",
    ongoingYes: "是",
    ongoingNo: "否",
    noSymptoms: "未提取到症状。请勿添加您没有报告的症状。",
    verified: "此内容出现在您的原始报告中。",
    unverified: "请根据您的原始报告核对此内容。",
    manualReview: "请仔细核对每项症状及其原始描述。",
    analysisClarification: "分析建议的问题（仅供查看）",
    reviewConfirmation: "我已检查此报告，并确认其准确反映了我的陈述。",
    submitReport: "确认并提交报告",
    submittingReport: "正在提交…",
    cancelReview: "修改我的报告",
    authLink: "打开参与者登录页面",
    analyzing: "正在分析您的报告…",
    preparing: "正在整理症状…",
    historyNotConnected: "当前参与者 API 暂不支持查看以往报告。",
    reportId: "报告编号",
    signOut: "退出登录",
    signingOut: "正在退出…",
    checkingSession: "正在检查登录状态…",
    sessionRequired: "请使用参与者账户登录后继续。",
    sessionExpired: "登录已过期。请重新登录后继续。",
    signOutError: "退出失败，请重试。",
  },
  vi: {
    tabs: { home: "Trang chủ", profile: "Hồ sơ", past: "Báo cáo cũ" },
    next: "Tiếp theo",
    howFeeling: "Hôm nay bạn cảm thấy thế nào?",
    tap: "Chạm và nói",
    listening: "Đang nghe… chạm để dừng",
    transcribing: "Đang phiên âm bản ghi…",
    transcriptInstruction: "Hãy xem lại và chỉnh sửa bản phiên âm. Nội dung chỉ được phân tích sau khi bạn xác nhận.",
    confirmTranscript: "Dùng bản phiên âm này và tiếp tục",
    rerecord: "Ghi âm lại",
    typeInstead: "Nhập bằng bàn phím",
    typePlaceholder: "Hãy viết bạn đang cảm thấy thế nào",
    heard: "Tôi đã nghe:",
    isRight: "Có đúng không?",
    yes: "Đúng rồi",
    change: "Không, tôi muốn sửa",
    saved: "Báo cáo của bạn đã được gửi để nhóm nghiên cứu xem xét.",
    safetyTitle: "Nếu bạn cảm thấy rất không khỏe",
    safety: `Hãy gọi ngay cho nhóm nghiên cứu theo số ${STUDY_TEAM_PHONE}. Nếu khẩn cấp, hãy gọi 911.`,
    noDiagnose: "Ứng dụng này không chẩn đoán bệnh. Nó chỉ ghi lại những gì bạn nói.",
    again: "Bắt đầu báo cáo mới",
    profileTitle: "Hồ sơ của bạn",
    language: "Ngôn ngữ",
    pastTitle: "Báo cáo cũ",
    pastEmpty: "Chưa có báo cáo cũ.",
    savedTag: "✓ Đã lưu",
    chatTitle: "Trung tâm thông báo",
    careTeam: "Bác sĩ hoặc điều phối viên của bạn",
    chatEmpty: "Chưa có thông báo.",
    chatDemoNotice: "Tin nhắn trong ứng dụng không phải là cảnh báo khẩn cấp.",
    notificationsLoading: "Đang tải thông báo…",
    notificationsError: "Không thể tải thông báo.",
    retry: "Thử lại",
    appointmentScheduled: "Đã lên lịch cuộc hẹn",
    scheduleLater: "Đã hiểu, tôi sẽ lên lịch hẹn sau",
    appointmentReported: "Bạn cho biết đã lên lịch hẹn theo dõi. Symora không đặt lịch hẹn.",
    laterReported: "Bạn đã yêu cầu được nhắc lên lịch hẹn theo dõi.",
    responseSaving: "Đang lưu phản hồi…",
    responseSaveError: "Không thể lưu phản hồi. Vui lòng thử lại.",
    openChat: "Mở trung tâm thông báo",
    closeChat: "Đóng trung tâm thông báo",
    notificationCount: "thông báo",
    reviewTitle: "Xem lại báo cáo của bạn",
    translatedReport: "Bản dịch tiếng Anh",
    summary: "Tóm tắt phân tích",
    extractedSymptoms: "Triệu chứng được trích xuất",
    symptom: "Triệu chứng",
    selectSymptom: "Chọn triệu chứng từ danh mục nghiên cứu",
    participantDescription: "Mô tả theo lời của bạn",
    descriptionError: "Mô tả không được vượt quá 2.000 ký tự.",
    reportedIntensity: "Mức độ bạn đã báo cáo (0–10)",
    intensityHint: "Để trống nếu bạn không nêu con số.",
    intensityError: "Mức độ phải là số nguyên từ 0 đến 10.",
    onsetDate: "Ngày bắt đầu (không bắt buộc)",
    onsetText: "Thời điểm trong phân tích",
    ongoing: "Triệu chứng này còn tiếp diễn không?",
    ongoingCandidate: "Gợi ý từ phân tích",
    unknown: "Không chắc / chưa báo cáo",
    ongoingYes: "Có",
    ongoingNo: "Không",
    noSymptoms: "Không trích xuất được triệu chứng nào. Đừng thêm triệu chứng bạn chưa báo cáo.",
    verified: "Chi tiết này có trong báo cáo ban đầu của bạn.",
    unverified: "Hãy kiểm tra chi tiết này với báo cáo ban đầu.",
    manualReview: "Hãy kiểm tra kỹ từng triệu chứng và mô tả ban đầu.",
    analysisClarification: "Câu hỏi gợi ý từ phân tích (chỉ để xem xét)",
    reviewConfirmation: "Tôi đã xem lại và xác nhận báo cáo phản ánh chính xác những gì tôi đã nói.",
    submitReport: "Xác nhận và gửi báo cáo",
    submittingReport: "Đang gửi…",
    cancelReview: "Sửa báo cáo của tôi",
    authLink: "Mở trang đăng nhập người tham gia",
    analyzing: "Đang phân tích báo cáo…",
    preparing: "Đang chuẩn bị thông tin triệu chứng…",
    historyNotConnected: "API dành cho người tham gia hiện chưa hỗ trợ xem báo cáo cũ.",
    reportId: "Mã tham chiếu báo cáo",
    signOut: "Đăng xuất",
    signingOut: "Đang đăng xuất…",
    checkingSession: "Đang kiểm tra phiên đăng nhập…",
    sessionRequired: "Vui lòng đăng nhập bằng tài khoản người tham gia để tiếp tục.",
    sessionExpired: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.",
    signOutError: "Đăng xuất không thành công. Vui lòng thử lại.",
  },
};

// Shared theme styles (same look as the doctor dashboard)
const glass = "border border-white/60 bg-white/40 shadow-lg backdrop-blur-md";
const big =
  "min-h-16 w-full rounded-full px-6 py-4 text-xl font-semibold transition-all duration-300 ease-out";
const primaryBtn = `${big} bg-forest-800 text-white hover:bg-leaf hover:ring-2 hover:ring-glow/70 hover:shadow-lg disabled:opacity-50`;
const secondaryBtn = `${big} border border-forest-800/30 bg-white/70 text-forest-800 hover:bg-white hover:ring-2 hover:ring-glow/60`;
const field =
  "w-full border border-forest-800/25 bg-white/90 text-lg transition-all duration-300 ease-out hover:ring-2 hover:ring-glow/60";


export default function ReportPage() {
  const router = useRouter();
  const [onboard, setOnboard] = useState<Onboard>("language");
  const [sessionReady, setSessionReady] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [flow, setFlow] = useState<Flow>("idle");
  const [lang, setLang] = useState<Language>("es");
  const [typing, setTyping] = useState(false);
  const [story, setStory] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [notifications, setNotifications] = useState<ParticipantNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationActionBusy, setNotificationActionBusy] = useState<string | null>(null);
  const [notificationActionError, setNotificationActionError] = useState<string | null>(null);
  const [reportSource, setReportSource] = useState<"portal" | "voice">("portal");
  const [reportActivity, setReportActivity] = useState<"idle" | "analyzing" | "preparing" | "submitting">("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  const [authenticationBlocked, setAuthenticationBlocked] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [prepared, setPrepared] = useState<PrepareReportResponse | null>(null);
  const [reviewSymptoms, setReviewSymptoms] = useState<EditablePreparedSymptom[]>([]);
  const [englishSummary, setEnglishSummary] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const [submittedReport, setSubmittedReport] = useState<SubmitReportResponse["report"] | null>(null);
  const [sessionChecking, setSessionChecking] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const notificationRequestRef = useRef<AbortController | null>(null);

  const L = copy[lang];
  const recorder = useRecorder(lang);

  const loadNotifications = useCallback(async () => {
    notificationRequestRef.current?.abort();
    const controller = new AbortController();
    notificationRequestRef.current = controller;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const result = await getParticipantNotifications(controller.signal);
      if (!controller.signal.aborted) setNotifications(result.notifications);
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotificationsError(error instanceof Error ? error.message : "");
      }
    } finally {
      if (notificationRequestRef.current === controller) {
        notificationRequestRef.current = null;
        setNotificationsLoading(false);
      }
    }
  }, []);

  async function respondToFollowUp(reportId: string, response: ParticipantFollowUpResponse) {
    if (notificationActionBusy) return;
    setNotificationActionBusy(reportId);
    setNotificationActionError(null);
    try {
      await saveParticipantFollowUpResponse(reportId, response);
      await loadNotifications();
    } catch {
      setNotificationActionError(L.responseSaveError);
    } finally {
      setNotificationActionBusy(null);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    getBrowserSession(controller.signal)
      .then((session) => {
        if (controller.signal.aborted) return;
        if (!session.authenticated) {
          router.replace("/participant-login");
          return;
        }
        if (session.user.role !== "participant") {
          router.replace("/dashboard");
          return;
        }
        setSessionReady(true);
        void loadNotifications();
      })
      .catch(() => {
        if (!controller.signal.aborted) router.replace("/participant-login");
      });
    return () => {
      controller.abort();
      notificationRequestRef.current?.abort();
    };
  }, [loadNotifications, router]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [notifications, chatOpen, notificationsLoading, notificationsError]);

  const notificationCount = notifications.length;

  function toggleNotificationCenter() {
    const opening = !chatOpen;
    setChatOpen(opening);
    if (opening) void loadNotifications();
  }

  function toggleMic() {
    if (recorder.status === "recording") {
      recorder.stop();
      return;
    }
    if (recorder.status === "processing" || reportActivity !== "idle") return;
    recorder.reset();
    setReportError(null);
    setAuthenticationBlocked(false);
    void recorder.start();
  }

  function reset() {
    recorder.reset();
    setFlow("idle");
    setStory("");
    setTyping(false);
    setAnalysis(null);
    setPrepared(null);
    setReviewSymptoms([]);
    setEnglishSummary("");
    setReviewConfirmed(false);
    setReportError(null);
    setAuthenticationBlocked(false);
    setSubmissionUncertain(false);
    setSubmittedReport(null);
  }

  function showRequestError(error: unknown) {
    if (error instanceof ApiError) {
      const sessionInvalid = error.status === 401 || error.code === "FORBIDDEN";
      setReportError(
        error.status === 401
          ? L.sessionExpired
          : error.status === 403 && error.code === "FORBIDDEN"
            ? L.sessionRequired
            : error.message,
      );
      setAuthenticationBlocked(
        error.status === 401 ||
          error.code === "FORBIDDEN" ||
          error.code === "BROWSER_AUTH_UNAVAILABLE" ||
          error.code === "DEMO_AUTH_UNAVAILABLE" ||
          error.message === "Authentication unavailable",
      );
      if (sessionInvalid) {
        setFlow("idle");
        setStory("");
        setAnalysis(null);
        setPrepared(null);
        setReviewSymptoms([]);
        setEnglishSummary("");
        setReviewConfirmed(false);
        setSubmittedReport(null);
        setChatOpen(false);
        notificationRequestRef.current?.abort();
        setNotifications([]);
        setNotificationsError(null);
        router.replace("/participant-login?session=expired");
        router.refresh();
      }
      return;
    }
    setReportError("Something went wrong. Please try again.");
    setAuthenticationBlocked(false);
  }

  async function prepareParticipantReport(transcript: string, source: "portal" | "voice") {
    if (!transcript.trim() || reportActivity !== "idle") return;
    setReportError(null);
    setAuthenticationBlocked(false);
    setSubmissionUncertain(false);
    setReviewConfirmed(false);
    setReportSource(source);
    setReportActivity("analyzing");
    try {
      const result = await analyzeReport({ transcript, language: lang });
      setAnalysis(result);
      setReportActivity("preparing");
      const preparedReport = await prepareReport({ source, transcript, analysis: result });
      setPrepared(preparedReport);
      setEnglishSummary(preparedReport.draft.englishSummary ?? "");
      setReviewSymptoms(preparedReport.draft.symptoms.map((symptom) => ({
        ...symptom,
        symptomCode: symptom.suggestedSymptomCode ?? "",
        reportedIntensity: null,
        onsetDate: "",
        ongoing: null,
        participantDescription: symptom.sourceExcerpt,
      })));
      setFlow("review");
    } catch (error) {
      showRequestError(error);
    } finally {
      setReportActivity("idle");
    }
  }

  async function submitPreparedReport() {
    if (!prepared || !analysis || !reviewConfirmed || submissionUncertain || reportActivity !== "idle") {
      return;
    }
    if (reviewSymptoms.some((symptom) => !symptom.symptomCode)) {
      setReportError(L.selectSymptom);
      return;
    }
    if (new Set(reviewSymptoms.map((symptom) => symptom.symptomCode)).size !== reviewSymptoms.length) {
      setReportError("Each symptom must have a different catalog entry.");
      return;
    }

    const request: SubmitReportRequest = {
      workflowStatus: "submitted",
      confirmed: true,
      source: reportSource,
      originalLanguage: prepared.draft.originalLanguage,
      originalTranscript: prepared.draft.originalTranscript,
      englishSummary: englishSummary.trim() || null,
      symptoms: reviewSymptoms.map((symptom) => ({
        symptomCode: symptom.symptomCode,
        reportedIntensity: symptom.reportedIntensity,
        onsetDate: symptom.onsetDate || null,
        ongoing: symptom.ongoing,
        participantDescription: symptom.participantDescription.trim() || null,
      })),
    };

    setReportError(null);
    setAuthenticationBlocked(false);
    setReportActivity("submitting");
    try {
      const result = await submitReport(request);
      setSubmittedReport(result.report);
      setFlow("done");
    } catch (error) {
      showRequestError(error);
      if (
        error instanceof ApiError &&
        (error.status === 0 ||
          error.status === 500 ||
          (error.status === 503 && error.code !== "DEMO_AUTH_UNAVAILABLE"))
      ) {
        setSubmissionUncertain(true);
      }
    } finally {
      setReportActivity("idle");
    }
  }

  async function enterApp() {
    setSessionChecking(true);
    setReportError(null);
    setAuthenticationBlocked(false);
    try {
      const session = await getBrowserSession();
      if (!session.authenticated || session.user.role !== "participant") {
        setReportError(L.sessionRequired);
        setAuthenticationBlocked(true);
        return;
      }
    } catch (error) {
      showRequestError(error);
      return;
    } finally {
      setSessionChecking(false);
    }
    setOnboard("done");
  }

  async function signOut() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setReportError(null);
    try {
      await logoutBrowserSession();
      notificationRequestRef.current?.abort();
      setNotifications([]);
      setNotificationsError(null);
      setChatOpen(false);
      reset();
      router.replace("/participant-login");
      router.refresh();
    } catch (error) {
      showRequestError(error);
    } finally {
      setLogoutBusy(false);
    }
  }

  const page =
    "flex min-h-screen flex-col bg-[#c3dccd] bg-gradient-to-br from-[#d8e8dd] via-[#c3dccd] to-[#a8cdbb] text-ink";

  if (!sessionReady) {
    return (
      <div className={page}>
        <BrandHeader/>
        <main className="flex flex-1 items-center justify-center p-4">
          <p role="status" className={`rounded-2xl p-5 text-center text-forest-800 ${glass}`}>
            Checking your session…
          </p>
        </main>
      </div>
    );
  }

  // ---------- First open: choose a language ----------
  if (onboard !== "done") {
    return (
      <div className={page}>
        <BrandHeader/>
        <div className="flex flex-1 p-3">
          <main className={`mx-auto flex w-full max-w-md flex-col gap-5 rounded-3xl p-6 ${glass}`}>
            {onboard === "language" && (
              <section className="flex flex-1 flex-col justify-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/symora-emblem.svg" alt="" className="mb-4 h-28 w-28 self-center" />
                <label className="flex flex-col gap-2 text-lg font-medium text-forest-800">
                  {L.language}
                  <span className="relative">
                    <select
                      value={lang}
                      onChange={(event) => setLang(event.target.value as Language)}
                      className={`${field} min-h-16 appearance-none rounded-full py-4 pl-5 pr-14 text-xl`}
                    >
                      {langOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="pointer-events-none absolute right-7 top-1/2 h-5 w-5 -translate-y-1/2 text-forest-800"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m7 10 5 5 5-5" />
                    </svg>
                  </span>
                </label>
                <button className={primaryBtn} disabled={sessionChecking} onClick={() => void enterApp()}>
                  {sessionChecking ? L.checkingSession : L.next}
                </button>
                {reportError && (
                  <div role="alert" className="rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
                    <p>{reportError}</p>
                    {authenticationBlocked && <a href="/participant-login" className="mt-2 inline-block font-semibold underline">{L.authLink}</a>}
                  </div>
                )}
              </section>
            )}
          </main>
        </div>
      </div>
    );
  }

  // ---------- Main app with side tabs ----------
  return (
    <div className={page}>
      <BrandHeader/>
      <div className="flex flex-1 flex-col gap-3 p-3 md:flex-row">
        <SideTabs tab={tab} onChange={setTab} labels={L.tabs} />

        <main className={`mx-auto flex w-full max-w-md flex-1 flex-col gap-5 rounded-3xl p-6 ${glass}`}>
          {tab === "home" && flow === "idle" && (
            <section className="flex flex-1 flex-col items-center justify-center gap-6">
              <h1 className="text-center text-3xl font-bold text-forest-800">{L.howFeeling}</h1>
              <MicHero
                listening={recorder.status === "recording"}
                onClick={toggleMic}
                label={
                  recorder.status === "recording"
                    ? L.listening
                    : recorder.status === "processing"
                      ? L.transcribing
                      : L.tap
                }
                disabled={
                  !sessionReady ||
                  recorder.status === "processing" ||
                  reportActivity !== "idle"
                }
              />
              <p aria-live="polite" className="text-center text-xl font-medium text-forest-800">
                {recorder.status === "recording"
                  ? L.listening
                  : recorder.status === "processing"
                    ? L.transcribing
                    : L.tap}
              </p>
              {recorder.status === "error" && (
                <div className="flex w-full flex-col gap-3" role="alert">
                  <p className="text-center text-sm text-red-900">{recorder.error}</p>
                  <button className={secondaryBtn} onClick={toggleMic}>
                    {L.rerecord}
                  </button>
                </div>
              )}
              {recorder.status === "review" && (
                <div className="flex w-full flex-col gap-3">
                  <label htmlFor="voice-transcript" className="text-sm font-medium text-forest-800">
                    {L.transcriptInstruction}
                  </label>
                  <textarea
                    id="voice-transcript"
                    value={recorder.transcript}
                    onChange={(event) => recorder.setTranscript(event.target.value)}
                    rows={4}
                    className={`${field} rounded-2xl p-4`}
                    disabled={reportActivity !== "idle"}
                  />
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={!recorder.transcript.trim() || reportActivity !== "idle"}
                    onClick={() => void prepareParticipantReport(recorder.transcript, "voice")}
                  >
                    {L.confirmTranscript}
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={reportActivity !== "idle"}
                    onClick={toggleMic}
                  >
                    {L.rerecord}
                  </button>
                </div>
              )}
              {!typing ? (
                <button className={secondaryBtn} onClick={() => setTyping(true)}>
                  {L.typeInstead}
                </button>
              ) : (
                <div className="flex w-full flex-col gap-3">
                  <textarea
                    value={story}
                    onChange={(event) => {
                      setStory(event.target.value);
                      setReportError(null);
                      setAuthenticationBlocked(false);
                    }}
                    placeholder={L.typePlaceholder}
                    rows={4}
                    className={`${field} rounded-2xl p-4`}
                  />
                  <button
                    className={primaryBtn}
                    disabled={
                      !story.trim() ||
                      reportActivity !== "idle" ||
                      recorder.status === "recording" ||
                      recorder.status === "processing"
                    }
                    onClick={() => void prepareParticipantReport(story, "portal")}
                  >
                    {reportActivity === "analyzing"
                      ? L.analyzing
                      : reportActivity === "preparing"
                        ? L.preparing
                        : L.next}
                  </button>
                </div>
              )}
              {reportActivity !== "idle" && (
                <p role="status" aria-live="polite" className="text-center text-sm text-forest-800">
                  {reportActivity === "analyzing" ? L.analyzing : L.preparing}
                </p>
              )}
              {reportError && (
                <div role="alert" className="w-full rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
                  <p>{reportError}</p>
                  {authenticationBlocked && (
                    <a href="/participant-login" className="mt-2 inline-block font-semibold underline">
                      {L.authLink}
                    </a>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === "home" && flow === "review" && analysis && prepared && (
            <ParticipantReportReview
              transcript={prepared.draft.originalTranscript}
              analysis={analysis}
              draft={prepared.draft}
              symptomCatalog={prepared.symptomCatalog}
              symptoms={reviewSymptoms}
              onSymptomsChange={setReviewSymptoms}
              englishSummary={englishSummary}
              onEnglishSummaryChange={setEnglishSummary}
              confirmed={reviewConfirmed}
              onConfirmedChange={setReviewConfirmed}
              onSubmit={() => void submitPreparedReport()}
              onCancel={() => {
                setFlow("idle");
                setTyping(true);
                setReportError(null);
                setReviewConfirmed(false);
              }}
              labels={{
                title: L.reviewTitle,
                originalTranscript: L.heard,
                translatedReport: L.translatedReport,
                summary: L.summary,
                extractedSymptoms: L.extractedSymptoms,
                symptom: L.symptom,
                selectSymptom: L.selectSymptom,
                participantDescription: L.participantDescription,
                descriptionError: L.descriptionError,
                reportedIntensity: L.reportedIntensity,
                intensityHint: L.intensityHint,
                intensityError: L.intensityError,
                onsetDate: L.onsetDate,
                onsetText: L.onsetText,
                ongoing: L.ongoing,
                ongoingCandidate: L.ongoingCandidate,
                unknown: L.unknown,
                ongoingYes: L.ongoingYes,
                ongoingNo: L.ongoingNo,
                noSymptoms: L.noSymptoms,
                verified: L.verified,
                unverified: L.unverified,
                manualReview: L.manualReview,
                analysisClarification: L.analysisClarification,
                reviewConfirmation: L.reviewConfirmation,
                submit: L.submitReport,
                submitting: L.submittingReport,
                cancel: L.cancelReview,
                authLink: L.authLink,
              }}
              isSubmitting={reportActivity === "submitting"}
              error={reportError}
              authenticationBlocked={authenticationBlocked}
              submissionUncertain={submissionUncertain}
            />
          )}

          {tab === "home" && flow === "done" && (
            <section className="flex flex-col gap-4">
              <p className="rounded-2xl bg-green-100 p-4 text-xl font-semibold text-green-900">
                ✓ {L.saved}
              </p>
              <div className="rounded-2xl border-2 border-glow bg-white/90 p-4">
                <h2 className="text-xl font-bold text-forest-800">{L.safetyTitle}</h2>
                <p className="text-lg">{L.safety}</p>
              </div>
              {submittedReport && (
                <p className="rounded-2xl border border-forest-800/15 bg-white/70 p-3 text-sm text-muted">
                  {L.reportId}: {submittedReport.id}
                </p>
              )}
              <p className="text-muted">{L.noDiagnose}</p>
              <button className={primaryBtn} onClick={reset}>
                {L.again}
              </button>
            </section>
          )}

          {tab === "profile" && (
            <section className="flex flex-col gap-6">
              <h1 className="text-3xl font-bold text-forest-800">{L.profileTitle}</h1>
              <fieldset>
                <legend className="mb-2 text-lg font-medium text-forest-800">{L.language}</legend>
                <div className="flex flex-col gap-3">
                  {langOptions.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      aria-pressed={lang === o.code}
                      onClick={() => setLang(o.code)}
                      className={`${big} ${
                        lang === o.code
                          ? "bg-gradient-to-r from-leaf to-forest-600 text-white ring-1 ring-glow/70 shadow-[0_0_18px_rgba(240,180,90,0.3)]"
                          : "border border-forest-800/30 bg-white/70 text-forest-800 hover:bg-white hover:ring-2 hover:ring-glow/60"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <hr className="border-t border-forest-800/20" />
              {reportError && <p role="alert" className="text-sm text-red-900">{reportError}</p>}
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={logoutBusy}
                className={secondaryBtn}
              >
                {logoutBusy ? L.signingOut : L.signOut}
              </button>
            </section>
          )}

          {tab === "past" && (
            <section className="flex flex-col gap-4">
              <h1 className="text-3xl font-bold text-forest-800">{L.pastTitle}</h1>
              <p className="text-lg text-muted">{L.historyNotConnected}</p>
            </section>
          )}

        </main>
      </div>

      {chatOpen && (
        <section
          id="patient-chat-panel"
          role="dialog"
          aria-labelledby="patient-chat-title"
          className="fixed bottom-20 right-4 z-40 flex h-[32rem] max-h-[calc(100dvh-6rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-forest-800/20 bg-white/95 shadow-2xl backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-forest-800/15 bg-sage/60 px-4 py-3">
            <div className="min-w-0">
              <h2 id="patient-chat-title" className="font-semibold text-forest-800">
                {L.chatTitle}
              </h2>
              <p className="truncate text-xs text-muted">{L.careTeam}</p>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              aria-label={L.closeChat}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-forest-800 transition-colors hover:bg-white/70"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>

          <div aria-live="polite" className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {notificationsLoading && (
              <p role="status" className="m-auto text-sm text-muted">{L.notificationsLoading}</p>
            )}
            {notificationsError && (
              <div role="alert" className="m-auto flex flex-col items-center gap-3 text-center text-sm text-red-900">
                <p>{L.notificationsError} {notificationsError}</p>
                <button
                  type="button"
                  onClick={() => void loadNotifications()}
                  className="rounded-full border border-forest-800/25 bg-white px-4 py-2 font-semibold text-forest-800 hover:bg-sage/40"
                >
                  {L.retry}
                </button>
              </div>
            )}
            {notificationActionError && (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
                {notificationActionError}
              </p>
            )}
            {!notificationsLoading && !notificationsError && notifications.length === 0 && (
              <p className="m-auto text-sm text-muted">{L.chatEmpty}</p>
            )}
            {notifications.map((notification) => (
                <div
                  key={notification.notificationId}
                  className="max-w-[85%] self-start rounded-2xl border border-forest-800/10 bg-sage px-3 py-2 text-sm text-ink"
                >
                  <p className="mb-0.5 text-xs font-semibold opacity-70">{L.careTeam}</p>
                  <p className="whitespace-pre-wrap break-words">{notification.message}</p>
                  {notification.participantResponse === "appointment_scheduled" && (
                    <p className="mt-2 text-xs font-medium">{L.appointmentReported}</p>
                  )}
                  {notification.participantResponse === "will_schedule_later" && (
                    <p className="mt-2 text-xs font-medium">{L.laterReported}</p>
                  )}
                  {(notification.notificationType === "follow_up_requested"
                    || notification.notificationType === "follow_up_reminder")
                    && notification.participantResponse !== "appointment_scheduled" && (
                      <div className="mt-3 flex flex-col gap-2">
                        {notificationActionBusy === notification.reportId && (
                          <p role="status" className="text-xs">{L.responseSaving}</p>
                        )}
                        {notification.participantResponse !== "will_schedule_later" && (
                          <button
                            type="button"
                            disabled={notificationActionBusy !== null}
                            onClick={() => void respondToFollowUp(notification.reportId, "will_schedule_later")}
                            className="rounded-full border border-forest-800/30 bg-white px-3 py-2 text-xs font-semibold text-forest-800 disabled:opacity-50"
                          >
                            {L.scheduleLater}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={notificationActionBusy !== null}
                          onClick={() => void respondToFollowUp(notification.reportId, "appointment_scheduled")}
                          className="rounded-full bg-forest-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {L.appointmentScheduled}
                        </button>
                      </div>
                    )}
                  <time
                    dateTime={notification.createdAt}
                    className="mt-1 block text-right text-[11px] opacity-70"
                  >
                    {formatNotificationTimestamp(notification.createdAt, lang)}
                  </time>
                </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <p className="px-4 pb-2 text-xs text-muted">{L.chatDemoNotice}</p>
        </section>
      )}

      <button
        type="button"
        onClick={toggleNotificationCenter}
        aria-label={
          chatOpen
            ? L.closeChat
            : `${L.openChat}${notificationCount ? `, ${notificationCount} ${L.notificationCount}` : ""}`
        }
        aria-expanded={chatOpen}
        aria-controls="patient-chat-panel"
        title={chatOpen ? L.closeChat : L.openChat}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-forest-800 text-white shadow-lg transition-all hover:bg-leaf hover:ring-4 hover:ring-glow/60"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" />
        </svg>
        {notificationCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-xs font-bold text-white"
          >
            {notificationCount > 9 ? "9+" : notificationCount}
          </span>
        )}
      </button>
    </div>
  );
}