const axios = require('axios');
const { transcribeAudio } = require('../utils/whisperService');
const PQueue = require('p-queue').default;
const os = require('os');
const logger = require('../utils/logger');

require('dotenv').config();

// Maintain a dedicated queue per user so messages from the same person
// are processed sequentially.  Without this, concurrent requests could
// interleave and produce race conditions in the conversation state.
const userQueues = new Map();

// Small delay between messages for a single user to reduce flooding.  Values
// lower than a few seconds risk tripping WhatsApp anti-spam detection.
const DELAY_BETWEEN_MESSAGES = Number(process.env.DELAY_BETWEEN_MESSAGES ?? 3000);

// Base URL for the Java backend.  Must be defined in the environment.
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
    logger.warn('WEBHOOK_URL não definido. As mensagens não serão encaminhadas.');
}

// Timeout (ms) for HTTP requests to the webhook.  Increase this if your
// backend takes longer to respond (e.g. heavy OpenAI workloads).
const WEBHOOK_TIMEOUT = Number(process.env.WEBHOOK_TIMEOUT ?? 60000);

// Global queue for CPU-intensive tasks such as audio transcription.  The
// concurrency defaults to half the available cores (rounded up) but can be
// overridden with the TRANSCRIBE_CONCURRENCY env var.  This prevents the
// machine from spawning too many concurrent transcriptions and starving
// other tasks.
const transcribeConcurrency = Number(process.env.TRANSCRIBE_CONCURRENCY || Math.ceil(os.cpus().length / 2));
const transcribeQueue = new PQueue({ concurrency: transcribeConcurrency });

function getQueue(userId) {
    if (!userQueues.has(userId)) {
        userQueues.set(userId, new PQueue({ concurrency: 1 }));
    }
    return userQueues.get(userId);
}

/**
 * Entry point for all messages received from the Baileys handler.  Pushes
 * processing into a per-user queue.  Errors in the queue are logged but
 * won't crash the bot.
 */
async function handleIncomingMessage(client, message) {
    const from = message?.from;
    if (!from) return;

    const queue = getQueue(from);
    queue
        .add(() => processMessage(client, message))
        .then(() => new Promise((res) => setTimeout(res, DELAY_BETWEEN_MESSAGES)))
        .catch((err) => logger.error(`Erro na fila de ${from}`, err));
}

/**
 * Determine how to handle a given message based on its type.  Delegates to
 * handleText for plain text messages and performs audio transcription for
 * voice notes.  Messages that are not recognised will trigger a fallback
 * response.
 */
async function processMessage(client, message) {
    const from = message.from;
    const { type, body, decryptFile } = message;

    message.handled = false;

    if (type === 'chat') {
        await handleText(client, from, body, message);
    } else if (type === 'audio') {
        try {
            const buffer = await decryptFile();
            await transcribeQueue.add(async () => {
                const text = await transcribeAudio(buffer);
                if (!text || text.trim() === '') {
                    message.handled = true;
                    await client.sendMessage(from, {
                        text: 'Não consegui entender. Pode repetir? 🥺'
                    });
                    return;
                }
                await handleText(client, from, text, message);
            });
        } catch (err) {
            logger.error('Erro ao transcrever áudio', err);
            message.handled = true;
            await client.sendMessage(from, {
                text: 'Erro ao entender o áudio. Pode repetir? 🥺'
            });
        }
    }

    // If the message was not handled by any of the above, reply with a
    // generic fallback.  This prevents the bot from silently ignoring
    // unsupported message types.
    if (!message.handled) {
        await client.sendMessage(from, {
            text: 'Desculpe, não entendi sua mensagem 😅'
        });
    }
}

/**
 * Send a text message to the Java backend and return the reply.  If an
 * error occurs, attempt to extract a meaningful cause and send it back to
 * the user instead of a generic error.  Timeout errors are silently
 * ignored (the user can simply resend their message).
 */
async function handleText(client, from, text, message) {
    try {
        logger.info(`Enviando para webhook: "${text}"`);

        const response = await axios.post(
            WEBHOOK_URL,
            { text, from },
            { timeout: WEBHOOK_TIMEOUT }
        );

// ✅ se o webhook devolver 204 (antispam), não envie fallback
        if (response.status === 204) {
            message.handled = true; // considere tratado (silencioso)
            logger.info(`Antispam 204 para ${from}`);
            return;
        }

        const reply = response.data?.reply;
        if (!reply || reply.trim() === '') {
            // ✅ sem reply -> considere tratado para não cair no fallback
            logger.info(`Sem reply`);
            message.handled = true;
            return;
        }

        message.handled = true;
        return await client.sendMessage(from, { text: reply });
    } catch (err) {
        // Log the full error for debugging.  err.response?.data may contain
        // additional context from the Java service.
        logger.error('Erro ao comunicar com o webhook', err);

        // Do not spam the user with an error message if the request simply
        // timed out or the backend is overloaded.  The user will likely
        // resend their message and the next attempt may succeed.
        if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message)) {
            return;
        }

        message.handled = true;

        // Build a more informative error to send back to the user.  We try
        // to extract a cause from Axios (HTTP errors) or from the error
        // object itself.  Only include generic information to avoid
        // leaking sensitive internal details.
        let cause = '';
        if (err.response) {
            // If the Java backend returned a JSON payload with a reply, use it.
            const backendReply = err.response.data?.reply;
            if (backendReply) {
                await client.sendMessage(from, { text: backendReply });
                return;
            }
            cause = `Código HTTP ${err.response.status}`;
        } else if (err.message) {
            cause = err.message;
        }

        const errorMessage = cause
            ? `Ocorreu um erro ao processar sua mensagem: ${cause}`
            : 'Ocorreu um erro inesperado ao processar sua mensagem.';

        await client.sendMessage(from, {
            text: errorMessage
        });
    }
}

module.exports = { handleIncomingMessage };