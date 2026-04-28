import { useEffect, useLayoutEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const KEY_TOKEN = "telegramBotToken";
const KEY_CHAT = "telegramChatId";
const KEY_PUSH = "telegramPushEnabled";
const KEY_APPROVAL = "telegramApprovalEnabled";
const EVENT_CHANGED = "telegram-config-changed";
const EVENT_PUSH = "telegram-push-changed";
const EVENT_APPROVAL = "telegram-approval-changed";

export interface TelegramState {
  botToken: string;
  chatId: string;
  pushEnabled: boolean;
  approvalEnabled: boolean;
  configured: boolean;
}

/**
 * Persistent Telegram push config: bot token, chat id, push toggle.
 * - botToken/chatId are saved together via `saveCredentials`.
 * - pushEnabled is saved on its own via `setPushEnabled`.
 * - `configured` mirrors `botToken && chatId` after trim.
 */
export function useTelegram() {
  const [botToken, setBotTokenState] = useState("");
  const [chatId, setChatIdState] = useState("");
  const [pushEnabled, setPushEnabledState] = useState(false);
  const [approvalEnabled, setApprovalEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const t = (await store.get<string>(KEY_TOKEN)) ?? "";
      const c = (await store.get<string>(KEY_CHAT)) ?? "";
      const p = (await store.get<boolean>(KEY_PUSH)) ?? false;
      const a = (await store.get<boolean>(KEY_APPROVAL)) ?? false;
      setBotTokenState(t);
      setChatIdState(c);
      setPushEnabledState(p);
      setApprovalEnabledState(a);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const u1 = listen<{ botToken: string; chatId: string }>(EVENT_CHANGED, (ev) => {
      setBotTokenState(ev.payload.botToken);
      setChatIdState(ev.payload.chatId);
    });
    const u2 = listen<boolean>(EVENT_PUSH, (ev) => {
      setPushEnabledState(ev.payload);
    });
    const u3 = listen<boolean>(EVENT_APPROVAL, (ev) => {
      setApprovalEnabledState(ev.payload);
    });
    return () => {
      u1.then((fn) => fn());
      u2.then((fn) => fn());
      u3.then((fn) => fn());
    };
  }, []);

  const saveCredentials = async (nextToken: string, nextChat: string) => {
    const store = await load("settings.json");
    await store.set(KEY_TOKEN, nextToken);
    await store.set(KEY_CHAT, nextChat);
    await store.save();
    setBotTokenState(nextToken);
    setChatIdState(nextChat);
    await emit(EVENT_CHANGED, { botToken: nextToken, chatId: nextChat });
    // If credentials are wiped out, force the push toggle off so we don't
    // leave a dangling "enabled but unconfigured" state.
    if (!nextToken.trim() || !nextChat.trim()) {
      await store.set(KEY_PUSH, false);
      await store.save();
      setPushEnabledState(false);
      await emit(EVENT_PUSH, false);
    }
  };

  const setPushEnabled = async (next: boolean) => {
    const store = await load("settings.json");
    await store.set(KEY_PUSH, next);
    await store.save();
    setPushEnabledState(next);
    await emit(EVENT_PUSH, next);
  };

  const setApprovalEnabled = async (next: boolean) => {
    const store = await load("settings.json");
    await store.set(KEY_APPROVAL, next);
    await store.save();
    setApprovalEnabledState(next);
    await emit(EVENT_APPROVAL, next);
  };

  const configured = botToken.trim().length > 0 && chatId.trim().length > 0;

  return {
    botToken,
    chatId,
    pushEnabled,
    approvalEnabled,
    configured,
    loaded,
    saveCredentials,
    setPushEnabled,
    setApprovalEnabled,
  };
}
