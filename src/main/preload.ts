import { contextBridge, ipcRenderer } from "electron";
import type { DogDogAPI } from "../shared/types";
const invoke = async (method: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(`dogdog:${method}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const api: DogDogAPI = {
  boot: () => invoke("boot"),
  refreshSessions: () => invoke("refreshSessions"),
  importTrace: () => invoke("importTrace"),
  openTrace: (path) => invoke("openTrace", path),
  saveReview: (review) => invoke("saveReview", review),
  saveSettings: (s) => invoke("saveSettings", s),
  preview: (review) => invoke("preview", review),
  diagnose: (review) => invoke("diagnose", review),
  cancel: () => invoke("cancel"),
  copy: (text) => invoke("copy", text),
  exportReview: (review) => invoke("exportReview", review),
  openGuide: (id) => invoke("openGuide", id),
  conversations: () => invoke("conversations"),
  createConversation: () => invoke("createConversation"),
  conversation: (id) => invoke("conversation", id),
  attachSources: (id, path) => invoke("attachSources", id, path),
  refreshSource: (id, sourceId) => invoke("refreshSource", id, sourceId),
  removeSource: (id, sourceId) => invoke("removeSource", id, sourceId),
  previewConversation: (id, text) => invoke("previewConversation", id, text),
  sendMessage: (id, text) => invoke("sendMessage", id, text),
  saveConversationReport: (id, messageId) =>
    invoke("saveConversationReport", id, messageId),
  onAgentEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on("dogdog:agentEvent", handler);
    return () => {
      ipcRenderer.removeListener("dogdog:agentEvent", handler);
    };
  },
};
contextBridge.exposeInMainWorld("dogdog", Object.freeze(api));
