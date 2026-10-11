"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { mockReports } from "@/lib/mock";
import {
  appendChatMessage,
  dailyChatKey,
  readFollowUpState,
  readChatMessages,
  subscribeToFollowUpState,
  subscribeToChatMessages,
  writeChatMessages,
  writeFollowUpState,
  type ChatMessage,
  type FollowUpState,
} from "@/lib/chat";
import { MicHero } from "@/components/ui/MicHero";
import { SideTabs, type Tab } from "@/components/ui/SideTabs";
import type { Language } from "@/lib/types";

type Onboard = "language" | "done";
type Flow = "idle" | "readback" | "done";

// Fictional placeholder for the demo
const STUDY_TEAM_PHONE = "[study team number]";
const DEMO_PARTICIPANT_CODE = "DEMO-014";
const noFollowUp: FollowUpState = {
  pending: false,
  appointmentScheduled: false,
  lastReminderDate: null,
};

const langOptions: { code: Language; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "zh", label: "中文（普通话）" },
  { code: "vi", label: "Tiếng Việt" },
];

const dateLocale: Record<Language, string> = {
  en: "en-US",
  es: "es-US",
  zh: "zh-CN",
  vi: "vi-VN",
};

const sampleStory: Record<Language, string> = {
  en: "My stomach hurts and I feel dizzy since Tuesday.",
  es: "Me duele el estómago y me siento mareada desde el martes.",
  zh: "我从星期二开始肚子疼，还觉得头晕。",
  vi: "Tôi bị đau bụng và thấy chóng mặt từ thứ Ba.",
};

const copy: Record<Language, {
  tabs: Record<Tab, string>;
  next: string;
  howFeeling: string;
  tap: string;
  listening: string;
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
  you: string;
  automatedMessage: string;
  chatEmpty: string;
  chatDemoNotice: string;
  openChat: string;
  closeChat: string;
  unreadMessages: string;
  reviewedMessage: string;
  followUpMessage: string;
  followUpReminder: string;
  appointmentScheduled: string;
  willScheduleLater: string;
}> = {
  en: {
    tabs: { home: "Home", profile: "Profile", past: "Past reports" },
    next: "Next",
    howFeeling: "How are you feeling today?",
    tap: "Tap and talk",
    listening: "Listening… tap to stop",
    typeInstead: "Type instead",
    typePlaceholder: "Write how you are feeling",
    heard: "I heard:",
    isRight: "Is that right?",
    yes: "Yes, that's right",
    change: "No, let me change it",
    saved: "Your report was saved for your study team to review.",
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
    you: "You",
    automatedMessage: "Automated message",
    chatEmpty: "No notifications yet.",
    chatDemoNotice: "Demo only. Messages are not secure and are not for emergencies.",
    openChat: "Open Notification Center",
    closeChat: "Close Notification Center",
    unreadMessages: "unread notifications",
    reviewedMessage: "Your doctor has reviewed your symptom report. Thank you for sharing how you are feeling.",
    followUpMessage: "Your doctor would like to follow up with you about your report. Please contact your doctor to schedule an appointment. If it is an emergency, call 911.",
    followUpReminder: "Reminder: Please contact your doctor to schedule a follow-up about your report. If it is an emergency, call 911.",
    appointmentScheduled: "Appointment Scheduled",
    willScheduleLater: "Understood, Will Schedule Later",
  },
  es: {
    tabs: { home: "Inicio", profile: "Perfil", past: "Reportes anteriores" },
    next: "Siguiente",
    howFeeling: "¿Cómo te sientes hoy?",
    tap: "Toca y habla",
    listening: "Escuchando… toca para detener",
    typeInstead: "Escribir en su lugar",
    typePlaceholder: "Escribe cómo te sientes",
    heard: "Escuché:",
    isRight: "¿Es correcto?",
    yes: "Sí, es correcto",
    change: "No, quiero cambiarlo",
    saved: "Tu reporte se guardó para que tu equipo del estudio lo revise.",
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
    you: "Tú",
    automatedMessage: "Mensaje automático",
    chatEmpty: "Aún no hay notificaciones.",
    chatDemoNotice: "Solo demostración. Los mensajes no son seguros ni para emergencias.",
    openChat: "Abrir el centro de notificaciones",
    closeChat: "Cerrar el centro de notificaciones",
    unreadMessages: "notificaciones sin leer",
    reviewedMessage: "Tu médico ha revisado tu reporte de síntomas. Gracias por compartir cómo te sientes.",
    followUpMessage: "Tu médico quiere dar seguimiento a tu reporte. Comunícate con tu médico para programar una cita. Si es una emergencia, llama al 911.",
    followUpReminder: "Recordatorio: Comunícate con tu médico para programar una cita de seguimiento sobre tu reporte. Si es una emergencia, llama al 911.",
    appointmentScheduled: "Cita programada",
    willScheduleLater: "Entendido, programaré la cita más adelante",
  },
  zh: {
    tabs: { home: "首页", profile: "我的资料", past: "以往报告" },
    next: "下一步",
    howFeeling: "您今天感觉怎么样？",
    tap: "点击并说话",
    listening: "正在聆听…点击停止",
    typeInstead: "改为打字",
    typePlaceholder: "请写下您的感受",
    heard: "我听到的是：",
    isRight: "对吗？",
    yes: "对，没错",
    change: "不对，我要修改",
    saved: "您的报告已保存，供您的研究团队查看。",
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
    you: "您",
    automatedMessage: "自动消息",
    chatEmpty: "暂无通知。",
    chatDemoNotice: "仅供演示。消息不安全，请勿用于紧急情况。",
    openChat: "打开通知中心",
    closeChat: "关闭通知中心",
    unreadMessages: "条未读通知",
    reviewedMessage: "您的医生已查看您的症状报告。感谢您分享您的感受。",
    followUpMessage: "您的医生希望就您的报告与您跟进。请联系您的医生预约。如果是紧急情况，请拨打911。",
    followUpReminder: "提醒：请联系您的医生，预约讨论您的报告。如果是紧急情况，请拨打911。",
    appointmentScheduled: "已预约",
    willScheduleLater: "明白，我稍后预约",
  },
  vi: {
    tabs: { home: "Trang chủ", profile: "Hồ sơ", past: "Báo cáo cũ" },
    next: "Tiếp theo",
    howFeeling: "Hôm nay bạn cảm thấy thế nào?",
    tap: "Chạm và nói",
    listening: "Đang nghe… chạm để dừng",
    typeInstead: "Nhập bằng bàn phím",
    typePlaceholder: "Hãy viết bạn đang cảm thấy thế nào",
    heard: "Tôi đã nghe:",
    isRight: "Có đúng không?",
    yes: "Đúng rồi",
    change: "Không, tôi muốn sửa",
    saved: "Báo cáo của bạn đã được lưu để nhóm nghiên cứu xem xét.",
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
    you: "Bạn",
    automatedMessage: "Tin nhắn tự động",
    chatEmpty: "Chưa có thông báo.",
    chatDemoNotice: "Chỉ dùng cho bản demo. Tin nhắn không bảo mật và không dành cho trường hợp khẩn cấp.",
    openChat: "Mở trung tâm thông báo",
    closeChat: "Đóng trung tâm thông báo",
    unreadMessages: "thông báo chưa đọc",
    reviewedMessage: "Bác sĩ đã xem báo cáo triệu chứng của bạn. Cảm ơn bạn đã chia sẻ về tình trạng của mình.",
    followUpMessage: "Bác sĩ muốn trao đổi thêm với bạn về báo cáo. Vui lòng liên hệ bác sĩ để đặt lịch hẹn. Nếu khẩn cấp, hãy gọi 911.",
    followUpReminder: "Nhắc nhở: Vui lòng liên hệ bác sĩ để đặt lịch trao đổi về báo cáo. Nếu khẩn cấp, hãy gọi 911.",
    appointmentScheduled: "Đã đặt lịch hẹn",
    willScheduleLater: "Đã hiểu, tôi sẽ đặt lịch sau",
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
const card = "rounded-2xl border border-forest-800/20 bg-white/80 p-4";

function Header() {
  return (
    <header className="flex items-center gap-3 bg-forest-950 px-6 py-2 text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/symora-emblem.svg" alt="" className="h-9 w-9" />
      <p className="font-[family-name:var(--font-fraunces)] text-3xl font-semibold leading-none tracking-wide">
        Symora
      </p>
    </header>
  );
}

export default function ReportPage() {
  const [onboard, setOnboard] = useState<Onboard>("language");
  const [tab, setTab] = useState<Tab>("home");
  const [flow, setFlow] = useState<Flow>("idle");
  const [lang, setLang] = useState<Language>("es");
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [story, setStory] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatKey, setChatKey] = useState("");
  const [followUpState, setFollowUpState] = useState<FollowUpState>(noFollowUp);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const L = copy[lang];

  useEffect(() => {
    const syncMessages = (next: ChatMessage[]) => {
      const updated = chatOpen
        ? next.map((message) =>
            message.from === "doctor" && !message.readByPatient
              ? { ...message, readByPatient: true }
              : message,
          )
        : next;
      if (updated.some((message, index) => message !== next[index])) {
        writeChatMessages(chatKey, updated);
      }
      setChatMessages(updated);
    };

    syncMessages(readChatMessages(chatKey));
    return subscribeToChatMessages(chatKey, syncMessages);
  }, [chatKey, chatOpen]);

  useEffect(() => {
    const syncFollowUpState = (next: FollowUpState) => {
      startTransition(() => setFollowUpState(next));
    };
    syncFollowUpState(readFollowUpState(DEMO_PARTICIPANT_CODE));
    return subscribeToFollowUpState(DEMO_PARTICIPANT_CODE, syncFollowUpState);
  }, []);

  useEffect(() => {
    if (onboard !== "done") return;
    const updateDailyChat = () => {
      const today = new Date().toLocaleDateString("en-CA");
      const nextKey = dailyChatKey(DEMO_PARTICIPANT_CODE, today);
      setChatKey((current) => (current === nextKey ? current : nextKey));
    };
    const interval = window.setInterval(updateDailyChat, 60_000);
    return () => window.clearInterval(interval);
  }, [onboard]);

  useEffect(() => {
    if (!chatKey || !followUpState.pending || followUpState.appointmentScheduled) return;
    const today = new Date().toLocaleDateString("en-CA");
    if (followUpState.lastReminderDate === today) return;

    appendChatMessage(chatKey, {
      from: "doctor",
      text: "Reminder: Please contact your doctor to schedule a follow-up about your report. If it is an emergency, call 911.",
      kind: "follow_up_reminder",
      auto: true,
      time: new Date().toLocaleTimeString("en-US", { timeStyle: "short" }),
      readByPatient: false,
    });
    writeFollowUpState(DEMO_PARTICIPANT_CODE, {
      ...followUpState,
      lastReminderDate: today,
    });
  }, [chatKey, followUpState]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  const unreadCount = chatMessages.filter(
    (message) => message.from === "doctor" && !message.readByPatient,
  ).length;
  const visibleChatMessages = chatMessages.filter((message) =>
    message.from === "doctor"
      ? message.auto
      : message.kind === "appointment_scheduled" || message.kind === "will_schedule_later",
  );
  const showFollowUpResponses =
    followUpState.pending &&
    !followUpState.appointmentScheduled &&
    visibleChatMessages.some(
      (message) =>
        message.kind === "follow_up_requested" || message.kind === "follow_up_reminder",
    );

  function toggleMic() {
    if (listening) {
      setListening(false);
      // Demo placeholder: replace with the transcript from POST /api/transcribe.
      setStory(sampleStory[lang]);
      setFlow("readback");
    } else {
      setListening(true);
    }
  }

  function reset() {
    setFlow("idle");
    setStory("");
    setTyping(false);
  }

  function respondToFollowUp(kind: "appointment_scheduled" | "will_schedule_later") {
    const current = readFollowUpState(DEMO_PARTICIPANT_CODE);
    if (!chatKey || !current.pending || current.appointmentScheduled) return;
    const today = new Date().toLocaleDateString("en-CA");
    appendChatMessage(chatKey, {
      from: "participant",
      text:
        kind === "appointment_scheduled"
          ? "Appointment Scheduled"
          : "Understood, Will Schedule Later",
      kind,
      time: new Date().toLocaleTimeString("en-US", { timeStyle: "short" }),
      readByPatient: true,
    });
    const nextState: FollowUpState = {
      ...current,
      pending: kind !== "appointment_scheduled",
      appointmentScheduled: kind === "appointment_scheduled",
      lastReminderDate: today,
    };
    setFollowUpState(nextState);
    writeFollowUpState(DEMO_PARTICIPANT_CODE, nextState);
  }

  function getLocalizedMessage(message: ChatMessage) {
    switch (message.kind) {
      case "reviewed":
        return L.reviewedMessage;
      case "follow_up_requested":
        return L.followUpMessage;
      case "follow_up_reminder":
        return L.followUpReminder;
      case "appointment_scheduled":
        return L.appointmentScheduled;
      case "will_schedule_later":
        return L.willScheduleLater;
    }
  }

  function enterApp() {
    const today = new Date().toLocaleDateString("en-CA");
    setChatKey(dailyChatKey(DEMO_PARTICIPANT_CODE, today));
    setOnboard("done");
  }

  // Keep the patient demo scoped to its existing mock participant.
  const past = mockReports.filter((r) => r.participantCode === DEMO_PARTICIPANT_CODE);

  const page =
    "flex min-h-screen flex-col bg-[#c3dccd] bg-gradient-to-br from-[#d8e8dd] via-[#c3dccd] to-[#a8cdbb] text-ink";

  // ---------- First open: choose a language ----------
  if (onboard !== "done") {
    return (
      <div className={page}>
        <Header />
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
                <button className={primaryBtn} onClick={enterApp}>
                  {L.next}
                </button>
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
      <Header />
      <div className="flex flex-1 flex-col gap-3 p-3 md:flex-row">
        <SideTabs tab={tab} onChange={setTab} labels={L.tabs} />

        <main className={`mx-auto flex w-full max-w-md flex-1 flex-col gap-5 rounded-3xl p-6 ${glass}`}>
          {tab === "home" && flow === "idle" && (
            <section className="flex flex-1 flex-col items-center justify-center gap-6">
              <h1 className="text-center text-3xl font-bold text-forest-800">{L.howFeeling}</h1>
              <MicHero
                listening={listening}
                onClick={toggleMic}
                label={listening ? L.listening : L.tap}
              />
              <p aria-live="polite" className="text-center text-xl font-medium text-forest-800">
                {listening ? L.listening : L.tap}
              </p>
              {!typing ? (
                <button className={secondaryBtn} onClick={() => setTyping(true)}>
                  {L.typeInstead}
                </button>
              ) : (
                <div className="flex w-full flex-col gap-3">
                  <textarea
                    value={story}
                    onChange={(e) => setStory(e.target.value)}
                    placeholder={L.typePlaceholder}
                    rows={4}
                    className={`${field} rounded-2xl p-4`}
                  />
                  <button
                    className={primaryBtn}
                    disabled={!story.trim()}
                    onClick={() => {
                      setFlow("readback");
                    }}
                  >
                    {L.next}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === "home" && flow === "readback" && (
            <section className="flex flex-col gap-4">
              {/* Placeholder: replace with Muna's POST /api/analyze summary in the patient's language */}
              <h1 className="text-3xl font-bold text-forest-800">{L.heard}</h1>
              <div className={`${card} flex flex-col gap-2 text-lg`}>
                <p>&ldquo;{story}&rdquo;</p>
              </div>
              <p className="text-xl font-medium text-forest-800">{L.isRight}</p>
              {/* Placeholder: call POST /api/reports here before showing the done screen */}
              <button className={primaryBtn} onClick={() => setFlow("done")}>
                {L.yes}
              </button>
              <button
                className={secondaryBtn}
                onClick={() => {
                  setFlow("idle");
                  setTyping(false);
                }}
              >
                {L.change}
              </button>
            </section>
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
            </section>
          )}

          {tab === "past" && (
            <section className="flex flex-col gap-4">
              <h1 className="text-3xl font-bold text-forest-800">{L.pastTitle}</h1>
              {past.length === 0 ? (
                <p className="text-lg text-muted">{L.pastEmpty}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {past.map((r) => (
                    <li
                      key={r.id}
                      className={`${card} border-l-8 border-l-green-600 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-glow/70`}
                    >
                      <div className="flex items-center justify-between gap-2 text-sm text-muted">
                        <span>
                          {new Date(r.createdAt).toLocaleDateString(dateLocale[lang], {
                            dateStyle: "medium",
                          })}
                        </span>
                        <span className="inline-flex h-7 min-w-24 items-center justify-center whitespace-nowrap rounded-full bg-green-100 px-3 text-sm font-medium text-green-900">
                          {L.savedTag}
                        </span>
                      </div>
                      <p className="mt-2 text-lg">&ldquo;{r.transcript}&rdquo;</p>
                    </li>
                  ))}
                </ul>
              )}
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
            {visibleChatMessages.length === 0 ? (
              <p className="m-auto text-sm text-muted">{L.chatEmpty}</p>
            ) : (
              visibleChatMessages.map((message, index) => (
                <div
                  key={`${message.time}-${index}`}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    message.from === "participant"
                      ? "self-end bg-forest-800 text-white"
                      : "self-start border border-forest-800/10 bg-sage text-ink"
                  }`}
                >
                  <p className="mb-0.5 text-xs font-semibold opacity-70">
                    {message.from === "doctor" ? L.careTeam : L.you}
                  </p>
                  {message.auto && (
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide opacity-70">
                      {L.automatedMessage}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{getLocalizedMessage(message)}</p>
                  <p className="mt-1 text-right text-[11px] opacity-70">{message.time}</p>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {showFollowUpResponses && (
            <div className="flex flex-col gap-2 border-t border-forest-800/15 p-3">
              <button
                type="button"
                onClick={() => respondToFollowUp("appointment_scheduled")}
                className="min-h-11 w-full rounded-full bg-forest-800 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-leaf"
              >
                {L.appointmentScheduled}
              </button>
              <button
                type="button"
                onClick={() => respondToFollowUp("will_schedule_later")}
                className="min-h-11 w-full rounded-full border border-forest-800/25 bg-white px-4 py-2 text-sm font-semibold text-forest-800 transition-colors hover:bg-sage/40"
              >
                {L.willScheduleLater}
              </button>
            </div>
          )}

          <p className="px-4 pb-2 text-xs text-muted">{L.chatDemoNotice}</p>
        </section>
      )}

      <button
        type="button"
        onClick={() => setChatOpen((open) => !open)}
        aria-label={
          chatOpen
            ? L.closeChat
            : `${L.openChat}${unreadCount ? `, ${unreadCount} ${L.unreadMessages}` : ""}`
        }
        aria-expanded={chatOpen}
        aria-controls="patient-chat-panel"
        title={chatOpen ? L.closeChat : L.openChat}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-forest-800 text-white shadow-lg transition-all hover:bg-leaf hover:ring-4 hover:ring-glow/60"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 4a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-xs font-bold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}