// utils/typingManager.js
// Mantém "Joana está digitando..." enquanto uma tarefa assíncrona roda (Baileys v6+)

const intervals = new Map();

/**
 * Inicia o "digitando..." e renova a cada ~4.5s até stopTyping().
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {{heartbeatMs?: number, subscribe?: boolean}} opts
 */
async function startTyping(sock, jid, opts = {}) {
    const heartbeatMs = opts.heartbeatMs ?? 4500;
    const subscribe = opts.subscribe ?? true;

    // Evita duplicar intervalos por JID
    stopTyping(sock, jid);

    try {
        if (subscribe) {
            // ajuda o WA a entregar updates de presença
            await sock.presenceSubscribe(jid).catch(() => {});
        }
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    } catch (_) {}

    const id = setInterval(() => {
        sock.sendPresenceUpdate('composing', jid).catch(() => {});
    }, heartbeatMs);

    intervals.set(jid, id);
}

/**
 * Para o "digitando..." e envia "paused".
 * Seguro para chamar múltiplas vezes.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 */
function stopTyping(sock, jid) {
    const id = intervals.get(jid);
    if (id) {
        clearInterval(id);
        intervals.delete(jid);
    }
    if (sock && jid) {
        sock.sendPresenceUpdate('paused', jid).catch(() => {});
    }
}

/**
 * Helper para envolver uma promise: liga typing antes e desliga ao final.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {string} jid
 * @param {() => Promise<any>} taskFn Função que executa a tarefa (ex: chamada OpenAI/Webhook)
 * @param {{maxMs?: number, heartbeatMs?: number}} opts
 */
async function withTyping(sock, jid, taskFn, opts = {}) {
    const maxMs = opts.maxMs ?? 120000; // fail-safe de 2min
    const heartbeatMs = opts.heartbeatMs ?? 4500;

    let timeout;
    try {
        await startTyping(sock, jid, { heartbeatMs });

        const timeoutPromise = new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('typing-timeout')), maxMs);
        });

        // Executa a tarefa concorrente a um fail-safe de tempo máximo
        const result = await Promise.race([taskFn(), timeoutPromise]);
        return result;
    } finally {
        clearTimeout(timeout);
        stopTyping(sock, jid);
    }
}

module.exports = { startTyping, stopTyping, withTyping };
