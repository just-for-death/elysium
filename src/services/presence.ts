/**
 * presence.ts  —  Real-time device presence & instant sync
 *
 * Maintains a single WebSocket to the sync-server.
 * Handles reconnection automatically with exponential back-off.
 *
 * Usage:
 *   presenceService.init(myDeviceCode)
 *   presenceService.onMessage(handler)
 *   presenceService.broadcastPresence(state, linkedCodes)
 *   presenceService.pushSync(payload, linkedCodes)
 *   presenceService.sendControl(targetCode, command)
 */

import { log } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PresenceState {
  videoId:      string;
  title:        string;
  author:       string;
  thumbnailUrl: string;
  paused:       boolean;
  currentTime?: number;
}

export type RemoteCommand = "play" | "pause" | "next" | "prev" | "seek";

export type SyncMessage =
  | { type: "registered";      deviceCode: string }
  | { type: "presence:update"; fromCode: string; presence: PresenceState | null; ts: string }
  | { type: "sync:data";       fromCode: string; payload: unknown; ts: string }
  | { type: "sync:ack";        delivered: number; ts: string }
  | { type: "remote:control";  fromCode: string; command: RemoteCommand; ts: string }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "pong" }
  | { type: "peer:online";     fromCode: string; presence?: PresenceState | null; ts: string }
  | { type: "peer:offline";    fromCode: string; ts: string }
  | { type: "pair:request";    fromCode: string; senderName: string; senderPlatform: string; ts: string }
  | { type: "pair:ack";        targetCode: string; delivered: number; ts: string };

type MessageHandler = (msg: SyncMessage) => void;

// ─── Service ──────────────────────────────────────────────────────────────────

const WS_PATH = "/api/live/ws";
const MAX_BACKOFF_MS = 30_000;

class PresenceService {
  private ws: WebSocket | null = null;
  private deviceCode: string   = "";
  private handlers: Set<MessageHandler> = new Set();
  private backoff = 1_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Messages queued while WS is not open */
  private queue: unknown[] = [];

  // ── Init ───────────────────────────────────────────────────────────────────

  init(deviceCode: string) {
    if (this.deviceCode === deviceCode && this.ws && this.ws.readyState === WebSocket.OPEN) {
      return; // already connected
    }
    this.deviceCode = deviceCode;
    this.intentionalClose = false;
    this.connect();
  }

  destroy() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer)      clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  // ── Connect ────────────────────────────────────────────────────────────────

  private connect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url   = `${proto}//${location.host}${WS_PATH}`;
    log.debug("[presence] connecting", { url, code: this.deviceCode });

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      log.warn("[presence] WebSocket constructor failed", { err });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoff = 1_000; // reset back-off on success
      log.debug("[presence] connected");
      this.send({ type: "register", deviceCode: this.deviceCode });
      this.emit({ type: "connected" });
      // Flush queued messages
      while (this.queue.length > 0) this.send(this.queue.shift());
      // Client-side keep-alive (server also pings but belt-and-suspenders)
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("{}");
      }, 20_000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SyncMessage;
        if (msg.type && msg.type !== "pong") this.emit(msg);
      } catch {
        // ignore keep-alive "{}" or malformed frames
      }
    };

    this.ws.onclose = (event) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.emit({ type: "disconnected" });
      if (!this.intentionalClose) {
        log.warn("[presence] disconnected", { code: event.code, reason: event.reason });
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      log.warn("[presence] ws error", { err });
      // onclose fires after onerror — reconnect handled there
    };
  }

  private scheduleReconnect() {
    if (this.intentionalClose) return;
    const delay = Math.min(this.backoff, MAX_BACKOFF_MS);
    log.debug("[presence] reconnecting in", { delay });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  private send(data: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(data);
      return;
    }
    this.ws.send(JSON.stringify(data));
  }

  // ── Emit ───────────────────────────────────────────────────────────────────

  private emit(msg: SyncMessage) {
    for (const h of this.handlers) {
      try { h(msg); } catch (err) { log.warn("[presence] handler error", { err }); }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Broadcast the current "now playing" state to all linked devices.
   * state = null means "nothing playing / stopped".
   */
  broadcastPresence(state: PresenceState | null, linkedCodes: string[]) {
    if (!linkedCodes.length) return;
    this.send({ type: "presence:update", presence: state, linkedCodes });
    log.debug("[presence] broadcast", { state: state?.title, targets: linkedCodes.length });
  }

  /**
   * Push presence to a single specific device (e.g. when it just came online).
   */
  broadcastPresenceTo(state: PresenceState | null, targetCode: string) {
    this.send({ type: "presence:update", presence: state, linkedCodes: [targetCode] });
    log.debug("[presence] broadcast:to", { state: state?.title, target: targetCode });
  }

  /**
   * Push full data snapshot to all linked devices instantly.
   * They receive it via sync:data message without any code ceremony.
   */
  pushSync(payload: unknown, linkedCodes: string[]) {
    if (!linkedCodes.length) return;
    this.send({ type: "sync:push", payload, linkedCodes });
    log.debug("[presence] push sync", { targets: linkedCodes.length });
  }

  /**
   * Send a playback command to a specific linked device.
   */
  sendControl(targetCode: string, command: RemoteCommand) {
    this.send({ type: "remote:control", targetCode, command });
    log.debug("[presence] control", { target: targetCode, command });
  }

  /**
   * Notify the target device that this device wants to pair with it.
   * The target device will auto-add this device to its linked list.
   */
  sendPairRequest(targetCode: string, senderName: string, senderPlatform: string) {
    this.send({ type: "pair:request", targetCode, senderName, senderPlatform });
    log.debug("[presence] pair:request", { target: targetCode });
  }
}

export const presenceService = new PresenceService();
