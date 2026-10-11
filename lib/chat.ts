export type ChatMessage = {
  from: "doctor" | "participant";
  text: string;
  time: string;
  kind:
    | "reviewed"
    | "follow_up_requested"
    | "follow_up_reminder"
    | "appointment_scheduled"
    | "will_schedule_later";
  auto?: boolean;
  readByPatient?: boolean;
};

export type FollowUpState = {
  pending: boolean;
  appointmentScheduled: boolean;
  lastReminderDate: string | null;
};

const CHAT_EVENT = "symora:chat-updated";
const FOLLOW_UP_EVENT = "symora:follow-up-updated";

const emptyFollowUpState: FollowUpState = {
  pending: false,
  appointmentScheduled: false,
  lastReminderDate: null,
};

export function dailyChatKey(participantCode: string, day: string) {
  return `${participantCode}:${day}`;
}

function storageKey(chatKey: string) {
  return `symora:chat:${chatKey}`;
}

function followUpStorageKey(participantCode: string) {
  return `symora:follow-up:${participantCode}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  const validKinds = [
    "reviewed",
    "follow_up_requested",
    "follow_up_reminder",
    "appointment_scheduled",
    "will_schedule_later",
  ];
  return (
    (message.from === "doctor" || message.from === "participant") &&
    typeof message.text === "string" &&
    typeof message.time === "string" &&
    validKinds.includes(message.kind as string) &&
    (message.auto === undefined || typeof message.auto === "boolean") &&
    (message.readByPatient === undefined || typeof message.readByPatient === "boolean")
  );
}

function isFollowUpState(value: unknown): value is FollowUpState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.pending === "boolean" &&
    typeof state.appointmentScheduled === "boolean" &&
    (typeof state.lastReminderDate === "string" || state.lastReminderDate === null)
  );
}

export function readChatMessages(chatKey: string): ChatMessage[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(chatKey)) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isChatMessage) : [];
  } catch {
    return [];
  }
}

export function writeChatMessages(chatKey: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(storageKey(chatKey), JSON.stringify(messages));
  } catch {
    // The UI remains usable if browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(CHAT_EVENT, { detail: chatKey }));
}

export function appendChatMessage(chatKey: string, message: ChatMessage) {
  const messages = [...readChatMessages(chatKey), message];
  writeChatMessages(chatKey, messages);
  return messages;
}

export function readFollowUpState(participantCode: string): FollowUpState {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(followUpStorageKey(participantCode)) ?? "null",
    );
    return isFollowUpState(stored) ? stored : emptyFollowUpState;
  } catch {
    return emptyFollowUpState;
  }
}

export function writeFollowUpState(participantCode: string, state: FollowUpState) {
  try {
    localStorage.setItem(followUpStorageKey(participantCode), JSON.stringify(state));
  } catch {
    // The UI remains usable if browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(FOLLOW_UP_EVENT, { detail: participantCode }));
}

export function subscribeToFollowUpState(
  participantCode: string,
  onChange: (state: FollowUpState) => void,
) {
  const key = followUpStorageKey(participantCode);
  const handleLocalUpdate = (event: Event) => {
    if ((event as CustomEvent<string>).detail === participantCode) {
      onChange(readFollowUpState(participantCode));
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) onChange(readFollowUpState(participantCode));
  };

  window.addEventListener(FOLLOW_UP_EVENT, handleLocalUpdate);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(FOLLOW_UP_EVENT, handleLocalUpdate);
    window.removeEventListener("storage", handleStorage);
  };
}

export function subscribeToChatMessages(chatKey: string, onChange: (messages: ChatMessage[]) => void) {
  const handleLocalUpdate = (event: Event) => {
    if ((event as CustomEvent<string>).detail === chatKey) {
      onChange(readChatMessages(chatKey));
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === storageKey(chatKey)) onChange(readChatMessages(chatKey));
  };

  window.addEventListener(CHAT_EVENT, handleLocalUpdate);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(CHAT_EVENT, handleLocalUpdate);
    window.removeEventListener("storage", handleStorage);
  };
}