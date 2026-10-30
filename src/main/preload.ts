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
};
contextBridge.exposeInMainWorld("dogdog", Object.freeze(api));
