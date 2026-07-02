import { bindTopbarActionEvents } from "./topbar-action-events.js?v=20260702-sessioncookie";
import { bindTopbarDrawerEvents } from "./topbar-drawer-events.js";
import { bindTopbarRankingEvents } from "./topbar-ranking-events.js";

export function bindTopbarEvents(dom, handlers) {
  bindTopbarActionEvents(dom, handlers);
  bindTopbarRankingEvents(dom, handlers);
  bindTopbarDrawerEvents(dom, handlers);
}
