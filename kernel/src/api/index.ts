// Public surface of the loopback API (item 08): the 127.0.0.1-only HTTP
// server, its Keychain bearer token and the durable kill switch.
export { API_HOST, STATUS_LIST_LIMIT, readStatus, startApiServer } from "./server.js";
export type { ApiServer, ApiServerDeps, ApiServerOptions, StatusBody } from "./server.js";
export {
  API_TOKEN_BYTES,
  API_TOKEN_KEYCHAIN_ACCOUNT,
  API_TOKEN_KEYCHAIN_SERVICE,
  ApiTokenError,
  ensureApiToken,
  isApiTokenShape,
} from "./token.js";
export {
  KILL_SWITCH_ENGAGED,
  KILL_SWITCH_RELEASED,
  engageKillSwitch,
  isKillSwitchEngaged,
  killSwitchState,
  releaseKillSwitch,
} from "./kill-switch.js";
export type { KillSwitchState } from "./kill-switch.js";
