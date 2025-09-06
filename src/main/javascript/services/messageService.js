// services/messageService.js
// Integra "digitando..." + fila por usuário usando o shape normalizado do seu index.js:
// { from, type, body, mimetype, decryptFile }

const axios = require('axios');
const PQueue = require('p-queue').default;
const { withTyping } = require('../utils/typingManager');
require('dotenv').config();

let logger = console;
try { logger = require('../utils/logger'); } catch {}

let transcribeAudio = null;
try { ({ transcribeAudio } = require('../utils/whisperService')); } catch {}

const userQueues = new Map();

const DELAY_BETWEEN_MESSAGES   = Number(process.env.DELAY_BETWEEN_MESSAGES ?? 3000);
const WEBHOOK_URL              = process.env.WEBHOOK_URL;
const WEBHOOK_TIMEOUT          = Number(process.env.WEBHOOK_TIMEOUT ?? 60000);
const TYPING_MAX_MS            = Number(process.env.TYPING_MAX_MS ?? 120000);
const TYPING_HEARTBEAT_MS      = Number(process.env.TYPING_HEARTBEAT_MS ?? 4500);

function getQueue(userId) {
    if (!userQueues.has(userId)) {
        userQueues.set(userId, new PQueue({ concurrency: 1 }));
    }
    return userQueues.get(userId);
}

/**
 * Entrada principal: enfileira por usuário
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {{from:string,type:string,body?:string,mimetype?:string,decryptFile?:()=>Promise<Buffer>}} message
 */
async function handleIncomingMessage(sock, message) {
    const from = message?.from;
    if (!from) return;

    const queue = getQueue(from);
    queue
        .add(() => processMessage(sock, message))
        .then(() => new Promise((res) => setTimeout(res, DELAY_BETWEEN_MESSAGES)))
        .catch((err) => logger.error?.('Erro ao processar mensagem:', err));
}

/**
 * Processa a msg com "digitando..." durante todo o fluxo pesado
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {{from:string,type:string,body?:string,mimetype?:string,decryptFile?:()=>Promise<Buffer>}} message
 */
async function processMessage(sock, message) {
    const from = message.from;

    return withTyping(
        sock,
        from,
        async () => {
            // 1) Obter texto: direto do body (chat) ou via transcrição (áudio)
            let text = (message.body || '').trim();

            if (!text && message.type === 'audio' && typeof transcribeAudio === 'function') {
                try {
                    const buf = typeof message.decryptFile === 'function'
                        ? await message.decryptFile()
                        : null;

                    text = await transcribeAudio({
                        buffer: buf,
                        mimetype: message.mimetype,
                        from
                    });
                } catch (err) {
                    logger.warn?.('Falha na transcrição de áudio:', err?.message || err);
                }
            }

            if (!text) text = 'Olá! Pode repetir sua mensagem?';

            // 2) Chamar seu backend (Spring -> OpenAI)
            if (!WEBHOOK_URL) {
                logger.error?.('WEBHOOK_URL não configurado no .env');
            }

            let data;
            try {
                const res = await axios.post(
                    WEBHOOK_URL,
                    { from, text },
                    { timeout: WEBHOOK_TIMEOUT }
                );
                data = res.data;
            } catch (err) {
                logger.error?.('Erro ao chamar backend (WEBHOOK_URL):', err?.message || err);
            }

            // 3) Extrair resposta e enviar
            const replyText =
                (data && (data.reply ?? data.message ?? data.result))
                    ? String(data.reply ?? data.message ?? data.result).trim()
                    : 'Desculpe, não consegui responder agora. Tente novamente 😊';

            await sock.sendMessage(from, { text: replyText });
            await sock.sendPresenceUpdate('available', from).catch(() => {});
        },
        { maxMs: TYPING_MAX_MS, heartbeatMs: TYPING_HEARTBEAT_MS }
    );
}

module.exports = {
    handleIncomingMessage,
    getQueue,
};
