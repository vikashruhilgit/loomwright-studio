// The preload: the renderer's ONLY way to the kernel. It runs sandboxed and
// context-isolated, and exposes exactly one key, `api`, on `window`. Every
// method forwards to the main process over IPC; the main process makes the
// API call with the Keychain token, which never crosses this bridge. Nothing
// here hands the renderer `ipcRenderer`, a channel name, or any Node API.
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { ApiRequest, ApiResult, FeedRelayFrame, KernelConnectionState, StudioBridge } from "../src/api/contract";
import { CHANNELS } from "./channels";

/** Subscribe to a main -> renderer channel; the listener gets only the payload, never the IPC event. */
function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: StudioBridge = {
  connection: () => ipcRenderer.invoke(CHANNELS.connection) as Promise<KernelConnectionState>,
  request: <R>(request: ApiRequest) => ipcRenderer.invoke(CHANNELS.request, request) as Promise<ApiResult<R>>,
  feed: {
    subscribe: (after: number) => ipcRenderer.invoke(CHANNELS.feedSubscribe, after) as Promise<KernelConnectionState>,
    unsubscribe: () => ipcRenderer.invoke(CHANNELS.feedUnsubscribe) as Promise<void>,
    onFrame: (listener: (frame: FeedRelayFrame) => void) => listen(CHANNELS.feedFrame, listener),
  },
  openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.openExternal, url) as Promise<boolean>,
  onNavigate: (listener: (route: string) => void) => listen(CHANNELS.navigate, listener),
};

contextBridge.exposeInMainWorld("api", api);
