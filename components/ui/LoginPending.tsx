"use client";

import { startTransition, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BrandHeader } from "@/components/ui/BrandHeader";
import {
  ApiError,
  getBrowserSession,
  loginCoordinator,
  loginParticipant,
  logoutBrowserSession,
} from "@/lib/frontend-api";

type Role = "participant" | "coordinator";
type Lang = "en" | "es" | "zh" | "vi";

const content: Record<Role, { title: string; description: string; audience: string; destination: string }> = {
  participant: {
    title: "Participant sign in",
    description: "Use the username and password provided by your study team.",
    audience: "Participant portal",
    destination: "/report",
  },
  coordinator: {
    title: "Coordinator sign in",
    description: "Use your coordinator demo account to open the report workspace.",
    audience: "Coordinator workspace",
    destination: "/dashboard",
  },
};

const langButtons: { code: Lang; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "zh", label: "中文" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "en", label: "English" },
];

const participantCopy: Record<Lang, {
  welcome: string;
  tagline: string;
  points: string[];
  start: string;
  signInTitle: string;
  signInDesc: string;
  username: string;
  password: string;
  signIn: string;
  signingIn: string;
  back: string;
  checking: string;
  demo: string;
}> = {
  en: {
    welcome: "Welcome to Symora",
    tagline: "Tell your study team how you are feeling, in your own language.",
    points: [
      "Speak or type in Spanish, Mandarin Chinese, Vietnamese or English.",
      "You check and correct everything before it is sent to your study team.",
      "Symora records what you say. It does not give medical advice or diagnoses.",
    ],
    start: "Get started",
    signInTitle: "Sign in",
    signInDesc: "Use the username and password your study team gave you.",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    back: "Back",
    checking: "Checking your session…",
    demo: "Demo with fictional data.",
  },
  es: {
    welcome: "Bienvenido a Symora",
    tagline: "Cuéntale a tu equipo del estudio cómo te sientes, en tu propio idioma.",
    points: [
      "Habla o escribe en español, chino mandarín, vietnamita o inglés.",
      "Tú revisas y corriges todo antes de enviarlo a tu equipo del estudio.",
      "Symora registra lo que dices. No da consejos médicos ni diagnósticos.",
    ],
    start: "Comenzar",
    signInTitle: "Iniciar sesión",
    signInDesc: "Usa el usuario y la contraseña que te dio tu equipo del estudio.",
    username: "Usuario",
    password: "Contraseña",
    signIn: "Iniciar sesión",
    signingIn: "Iniciando sesión…",
    back: "Atrás",
    checking: "Verificando tu sesión…",
    demo: "Demostración con datos ficticios.",
  },
  zh: {
    welcome: "欢迎使用 Symora",
    tagline: "用您自己的语言，告诉研究团队您的感受。",
    points: [
      "可以用西班牙语、普通话、越南语或英语说话或打字。",
      "发送给研究团队之前，所有内容都由您检查和修改。",
      "Symora 只记录您说的话，不提供医疗建议或诊断。",
    ],
    start: "开始",
    signInTitle: "登录",
    signInDesc: "请使用研究团队提供的用户名和密码。",
    username: "用户名",
    password: "密码",
    signIn: "登录",
    signingIn: "正在登录…",
    back: "返回",
    checking: "正在检查您的登录状态…",
    demo: "演示版，使用虚构数据。",
  },
  vi: {
    welcome: "Chào mừng đến với Symora",
    tagline: "Hãy cho nhóm nghiên cứu biết bạn cảm thấy thế nào, bằng ngôn ngữ của bạn.",
    points: [
      "Nói hoặc gõ bằng tiếng Tây Ban Nha, tiếng Trung phổ thông, tiếng Việt hoặc tiếng Anh.",
      "Bạn kiểm tra và chỉnh sửa mọi thứ trước khi gửi cho nhóm nghiên cứu.",
      "Symora chỉ ghi lại những gì bạn nói. Ứng dụng không đưa ra lời khuyên y tế hay chẩn đoán.",
    ],
    start: "Bắt đầu",
    signInTitle: "Đăng nhập",
    signInDesc: "Hãy dùng tên đăng nhập và mật khẩu mà nhóm nghiên cứu đã cung cấp.",
    username: "Tên đăng nhập",
    password: "Mật khẩu",
    signIn: "Đăng nhập",
    signingIn: "Đang đăng nhập…",
    back: "Quay lại",
    checking: "Đang kiểm tra phiên của bạn…",
    demo: "Bản demo với dữ liệu giả.",
  },
};

export function LoginPending({ role }: { role: Role }) {
  const router = useRouter();
  const copy = content[role];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [existingRole, setExistingRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [started, setStarted] = useState(role === "coordinator");

  const isParticipant = role === "participant";
  const t = participantCopy[lang];
  const title = isParticipant ? t.signInTitle : copy.title;
  const description = isParticipant ? t.signInDesc : copy.description;
  const showWelcome = isParticipant && !started;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("session") === "expired") {
      startTransition(() => setSessionExpired(true));
    }
    let active = true;
    getBrowserSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated) {
          if (session.user.role === role) window.location.replace(copy.destination);
          else setExistingRole(session.user.role);
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setSessionUnavailable(cause instanceof ApiError && cause.status === 503);
        setError(cause instanceof Error ? cause.message : "Session status is unavailable.");
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
    };
  }, [copy.destination, role]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || checkingSession || sessionUnavailable || existingRole) return;
    const enteredPassword = password;
    setPassword("");
    setError(null);
    setSubmitting(true);
    try {
      const session = role === "participant"
        ? await loginParticipant(username.trim(), enteredPassword)
        : await loginCoordinator(username.trim(), enteredPassword);
      if (!session.authenticated || session.user.role !== role) {
        throw new ApiError("This account is not available for this portal.", 403, "FORBIDDEN");
      }
      router.replace(copy.destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed. Please try again.");
      setSessionUnavailable(cause instanceof ApiError && cause.status === 503);
    } finally {
      setSubmitting(false);
    }
  }

  async function signOutOtherRole() {
    setError(null);
    setSubmitting(true);
    try {
      await logoutBrowserSession();
      setExistingRole(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const hoverGlow =
    "transition-all duration-300 ease-out hover:ring-2 hover:ring-glow/70 hover:shadow-lg";

  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-br from-[#d8e8dd] via-[#c3dccd] to-[#a8cdbb] text-ink">
      <BrandHeader />
      <div className="flex flex-1 items-center justify-center p-4">
        <section className="flex w-full max-w-md flex-col gap-5 rounded-3xl border border-white/60 bg-white/55 p-6 shadow-lg backdrop-blur-md">
          {isParticipant && (
            <div role="group" aria-label="Language" className="flex flex-wrap justify-center gap-2">
              {langButtons.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  aria-pressed={lang === l.code}
                  onClick={() => setLang(l.code)}
                  className={`min-h-10 rounded-full px-4 text-sm font-semibold transition-all duration-300 ease-out ${
                    lang === l.code
                      ? "bg-gradient-to-r from-leaf to-forest-600 text-white ring-1 ring-glow/70"
                      : "border border-forest-800/25 bg-white/70 text-forest-800 hover:bg-white hover:ring-2 hover:ring-glow/60"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}

          {checkingSession ? (
            <p role="status" className="rounded-2xl bg-white/70 p-4 text-sm text-forest-800">
              {isParticipant ? t.checking : "Checking your session…"}
            </p>
          ) : existingRole ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
                This browser is signed in as a {existingRole}. Sign out before switching portals.
              </p>
              <button
                type="button"
                onClick={() => void signOutOtherRole()}
                disabled={submitting}
                className="min-h-14 w-full rounded-full bg-forest-800 px-6 py-3 font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Signing out…" : "Sign out current session"}
              </button>
            </div>
          ) : showWelcome ? (
            <div className="flex flex-col items-center gap-5 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/symora-emblem.svg" alt="" className="h-28 w-28" />
              <p aria-hidden="true" className="text-sm font-semibold tracking-wide text-forest-700">
                Welcome · Bienvenido · 欢迎 · Chào mừng
              </p>
              <h1 className="font-[family-name:var(--font-fraunces)] text-4xl font-semibold text-forest-800">
                {t.welcome}
              </h1>
              <p className="text-lg text-forest-800">{t.tagline}</p>
              <ul className="flex w-full flex-col gap-2 text-left">
                {t.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 rounded-2xl border border-forest-800/15 bg-white/70 p-3 text-base"
                  >
                    <span aria-hidden="true" className="mt-0.5 text-[#c27b1f]">✦</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setStarted(true)}
                className={`min-h-16 w-full rounded-full bg-forest-800 px-6 py-4 text-xl font-semibold text-white hover:bg-leaf ${hoverGlow}`}
              >
                {t.start}
              </button>
              <p className="text-sm text-muted">{t.demo}</p>
            </div>
          ) : (
            <>
              {isParticipant && (
                <button
                  type="button"
                  onClick={() => setStarted(false)}
                  className="self-start text-sm font-semibold text-forest-700 underline"
                >
                  ← {t.back}
                </button>
              )}
              {!isParticipant && (
                <p className="text-sm font-semibold uppercase text-forest-700">{copy.audience}</p>
              )}
              <h1 className="text-3xl font-bold text-forest-800">{title}</h1>
              <p className="text-muted">{description}</p>
              {sessionExpired && (
                <p role="status" className="rounded-2xl border border-amber-700/20 bg-amber-50/80 p-4 text-sm text-amber-950">
                  Your session expired or is no longer valid. Sign in again to continue.
                </p>
              )}
              <form onSubmit={submit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-2 font-medium text-forest-800">
                  {isParticipant ? t.username : "Username"}
                  <input
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value.toLowerCase())}
                    autoComplete="username"
                    minLength={3}
                    maxLength={64}
                    required
                    disabled={sessionUnavailable || submitting}
                    className={`min-h-12 rounded-xl border border-forest-800/25 bg-white px-4 ${hoverGlow}`}
                  />
                </label>
                <label className="flex flex-col gap-2 font-medium text-forest-800">
                  {isParticipant ? t.password : "Password"}
                  <input
                    name="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    minLength={1}
                    maxLength={256}
                    required
                    disabled={sessionUnavailable || submitting}
                    className={`min-h-12 rounded-xl border border-forest-800/25 bg-white px-4 ${hoverGlow}`}
                  />
                </label>
                {error && (
                  <p role="alert" className="rounded-2xl border border-red-800/20 bg-red-50 p-3 text-sm text-red-900">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={sessionUnavailable || submitting || !username || !password}
                  className={`min-h-14 w-full rounded-full bg-forest-800 px-6 py-3 font-semibold text-white hover:bg-leaf disabled:opacity-50 ${hoverGlow}`}
                >
                  {submitting
                    ? isParticipant ? t.signingIn : "Signing in…"
                    : isParticipant ? t.signIn : "Sign in"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}