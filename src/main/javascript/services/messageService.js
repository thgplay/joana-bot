const axios = require('axios');
const { transcribeAudio } = require('../utils/whisperService');
const PQueue = require('p-queue').default;

require('dotenv').config();

const userQueues = new Map();
const DELAY_BETWEEN_MESSAGES = 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TIMEOUT = 5000;

function getQueue(userId) {
    if (!userQueues.has(userId)) {
        userQueues.set(userId, new PQueue({ concurrency: 1 }));
    }
    return userQueues.get(userId);
}

async function handleIncomingMessage(client, message) {
    const from = message?.key?.remoteJid;
    if (!from) return;

    const queue = getQueue(from);
    queue.add(() => processMessage(client, message))
        .then(() => new Promise(res => setTimeout(res, DELAY_BETWEEN_MESSAGES)))
        .catch(err => console.error(`❌ Erro na fila de ${from}:`, err));
}

async function processMessage(client, message) {
    const from = message.key.remoteJid;
    const content = message.message;

    const type = Object.keys(content)[0];
    const msgContent = content[type];

    if (type === 'conversation' || type === 'extendedTextMessage') {
        const text = msgContent.text || msgContent || '';
        return await handleText(client, from, text);
    }

    if (type === 'audioMessage') {
        try {
            const buffer = await client.decryptMediaMessage(message);
            const text = await transcribeAudio(buffer);
            if (!text || text.trim() === '') {
                return await client.sendMessage(from, { text: "Não consegui entender. Pode repetir? 🥺" });
            }
            return await handleText(client, from, text);
        } catch (err) {
            console.error(`❌ Erro ao transcrever áudio:`, err);
            return await client.sendMessage(from, { text: "Erro ao entender o áudio. Pode repetir? 🥺" });
        }
    }

    return await client.sendMessage(from, { text: "Desculpe, não entendi sua mensagem 😅" });
}

async function handleText(client, from, text) {
    try {
        console.log(`📤 Enviando para webhook: "${text}"`);

        const response = await axios.post(WEBHOOK_URL, {
            text,
            from
        }, { timeout: WEBHOOK_TIMEOUT });

        const reply = response.data?.reply;
        if (!reply || reply.trim() === '') return;

        await client.sendMessage(from, { text: reply });
    } catch (err) {
        console.error('❌ Erro ao comunicar com o webhook:', err.message);
        await client.sendMessage(from, { text: "Erro ao processar sua mensagem. Tente novamente mais tarde!" });
    }
}

module.exports = { handleIncomingMessage };
