"use strict";

/**
 * logger.js — Shared structured logger for Elysium services
 *
 * Provides consistent structured JSON logging across all services:
 * - Main server
 * - Queue recommendation service
 * - Sync server
 *
 * Log format: {"ts":"ISO","level":"INFO","svc":"elysium","msg":"...","...extra}
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info("event:message", { key: "value" });
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a logger instance with the specified service name
 * @param {string} serviceName - The service identifier (e.g., "elysium", "sync")
 * @returns {object} Logger instance with debug, info, warn, error methods
 */
function createLogger(serviceName = "elysium") {
  const logLevel = LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVELS.info;

  return {
    _emit(level, msg, extra = {}) {
      if (LEVELS[level] < logLevel) return;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level: level.toUpperCase(),
        svc: serviceName,
        msg,
        ...extra,
      });
      (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
    },
    debug(msg, extra) { this._emit("debug", msg, extra); },
    info(msg, extra) { this._emit("info", msg, extra); },
    warn(msg, extra) { this._emit("warn", msg, extra); },
    error(msg, extra) { this._emit("error", msg, extra); },
  };
}

module.exports = { createLogger };
