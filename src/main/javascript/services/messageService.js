// javascript/services/messageService.js
// Resilient webhook posting with structured logging for "Estou um pouco ocupada agora." reasons.

const axios = require("axios");
const http = require("http");
const https = require("https");

const KEEP_ALIVE_AGENT_HTTP = new http.Agent({keepAlive: true, maxSockets: 100});
const KEEP_ALIVE_AGENT_HTTPS = new https.Agent({keepAlive: true, maxSockets: 100});

// ===== Configuration =====
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TIMEOUT = Number(process.env.WEBHOOK_TIMEOUT || 90_000);
const MAX_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES || 3);
const INITIAL_BACKOFF_MS = Number(process.env.WEBHOOK_INITIAL_BACKOFF_MS || 600);

// ===== Utilities =====
function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

function nowTs() {
    return new Date().toISOString();
}

function jitter(base) {
    // +/- 20% jitter
    const delta = base * 0.2;
    return base + (Math.random() * 2 * delta - delta);
}

function nextBackoff(attempt) {
    // attempt: 1..N
    return INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
}

function createEventId() {
    return `busy_${uuidv4()}`;
}

// lightweight UUIDv4 (no dep)
function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Basic structured logger
function log(level, msg, extra = {}) {
    const rec = {
        level, msg, time: nowTs(), ...extra,
    };
    // Prefer single-line JSON for easy ingestion by ELK/CloudWatch etc.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(rec));
}

const BusyReason = Object.freeze({
    RATE_LIMITED: "RATE_LIMITED",
    SERVER_ERROR: "SERVER_ERROR",
    NETWORK_ERROR: "NETWORK_ERROR",
    TIMEOUT: "TIMEOUT",
    RETRIES_EXHAUSTED: "RETRIES_EXHAUSTED",
    CIRCUIT_OPEN: "CIRCUIT_OPEN",
    QUEUE_OVERFLOW: "QUEUE_OVERFLOW",
    INVALID_PAYLOAD: "INVALID_PAYLOAD",
    UNKNOWN: "UNKNOWN",
});

/**
 * Log explicit reason for sending the "Estou um pouco ocupada agora." message.
 * @param {Object} ctx contextual data like chatId, userId, messageId
 * @param {Object} meta http/axios metadata (status, code, requestId, attempts, elapsedMs, url)
 * @param {string} reason enum from BusyReason
 */
function logBusyReason(ctx, meta, reason) {
    const eventId = createEventId();
    log("warn", "Sent BUSY message to user", {
        eventId, reason, chatId: ctx?.chatId, userId: ctx?.userId, messageId: ctx?.messageId, webhook: {
            url: meta?.url,
            status: meta?.status,
            requestId: meta?.requestId,
            attempts: meta?.attempts,
            elapsedMs: meta?.elapsedMs,
            errorCode: meta?.errorCode,
            errorMessage: meta?.errorMessage,
        },
    });
    return eventId;
}

/**
 * Decide if HTTP status should trigger "busy" response.
 * We treat 429 and any 5xx as busy.
 */
function statusIsBusy(status) {
    if (!status) return false;
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
}

/**
 * Post to webhook with retries/backoff. Returns { ok, status, data, reason? }
 */
async function postWithRetries(url, payload, options = {}) {
    const started = Date.now();
    let attempts = 0;
    let lastErr = null;
    let lastResp = null;

    while (attempts < MAX_RETRIES) {
        attempts += 1;
        try {
            const resp = await axios.post(url, payload, {
                timeout: WEBHOOK_TIMEOUT,
                httpAgent: KEEP_ALIVE_AGENT_HTTP,
                httpsAgent: KEEP_ALIVE_AGENT_HTTPS,
                validateStatus: () => true, // We'll handle manual
            });
            lastResp = resp;

            // If success (2xx), return ok
            if (resp.status >= 200 && resp.status < 300) {
                return {
                    ok: true,
                    status: resp.status,
                    data: resp.data,
                    attempts,
                    elapsedMs: Date.now() - started,
                    requestId: resp.headers?.["x-request-id"],
                };
            }

            // Non-2xx - only retry on 429/5xx
            if (statusIsBusy(resp.status) && attempts < MAX_RETRIES) {
                const wait = jitter(nextBackoff(attempts));
                log("info", "Retrying webhook due to busy status", {
                    attempt: attempts, waitMs: Math.round(wait), status: resp.status, url,
                });
                await sleep(wait);
                continue;
            }

            // Non-retryable status - return as is
            return {
                ok: false,
                status: resp.status,
                data: resp.data,
                attempts,
                elapsedMs: Date.now() - started,
                requestId: resp.headers?.["x-request-id"],
            };
        } catch (err) {
            lastErr = err;
            const code = err?.code;
            const isTimeout = code === "ECONNABORTED" || (typeof err?.message === "string" && err.message.toLowerCase().includes("timeout"));
            const isNetwork = ["ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"].includes(code);

            if ((isTimeout || isNetwork) && attempts < MAX_RETRIES) {
                const wait = jitter(nextBackoff(attempts));
                log("info", "Retrying webhook due to network/timeout", {
                    attempt: attempts, waitMs: Math.round(wait), code, url,
                });
                await sleep(wait);
                continue;
            }

            // Final error
            return {
                ok: false,
                errorCode: code || "ERR_AXIOS",
                errorMessage: err?.message,
                attempts,
                elapsedMs: Date.now() - started,
            };
        }
    }

    // If loop exits, retries exhausted
    const elapsedMs = Date.now() - started;
    return {ok: false, attempts: MAX_RETRIES, elapsedMs, errorCode: "RETRIES_EXHAUSTED"};
}

/**
 * Decide and send the response to the user based on webhook result.
 * When sending the "busy" message, it will LOG the exact reason.
 */
async function processIncomingMessage(ctx, inbound) {
    // ctx: { chatId, userId, messageId }
    // inbound: normalized message payload

    if (!WEBHOOK_URL) {
        const eventId = logBusyReason(ctx, {url: "(missing WEBHOOK_URL)"}, BusyReason.INVALID_PAYLOAD);
        await sendWhatsAppText(ctx.chatId, "Estou um pouco ocupada agora. (id " + eventId + ")");
        return;
    }

    const result = await postWithRetries(WEBHOOK_URL, {ctx, inbound});

    if (result.ok) {
        // Assume the webhook returns a response to forward.
        if (result?.data?.replyText) {
            await sendWhatsAppText(ctx.chatId, result.data.replyText);
        }
        return;
    }

    // Determine busy reason
    let reason = BusyReason.UNKNOWN;
    let meta = {
        url: WEBHOOK_URL,
        status: result.status,
        attempts: result.attempts,
        elapsedMs: result.elapsedMs,
        requestId: result.requestId,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
    };

    if (typeof result.status === "number" && statusIsBusy(result.status)) {
        reason = result.status === 429 ? BusyReason.RATE_LIMITED : BusyReason.SERVER_ERROR;
    } else if (result.errorCode === "RETRIES_EXHAUSTED") {
        reason = BusyReason.RETRIES_EXHAUSTED;
    } else if (result.errorCode === "ECONNABORTED") {
        reason = BusyReason.TIMEOUT;
    } else if (["ECONNRESET", "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"].includes(result.errorCode)) {
        reason = BusyReason.NETWORK_ERROR;
    }

    // Log and send busy message with correlation id
    const eventId = logBusyReason(ctx, meta, reason);
    await sendWhatsAppText(ctx.chatId, "Estou um pouco ocupada agora. Por favor, tente novamente em instantes. (id " + eventId + ")");
}

// Stub: replace with your actual WhatsApp/Baileys sender
async function sendWhatsAppText(chatId, text) {
    // Implement with your queue/PQueue if needed
    log("info", "Sending WhatsApp text", {chatId, length: text?.length});
    // Your real send logic here...
}

module.exports = {
    processIncomingMessage, BusyReason, logBusyReason, postWithRetries,
};
