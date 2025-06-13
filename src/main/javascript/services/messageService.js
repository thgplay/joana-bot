const axios = require('axios');
const { transcribeAudio } = require('../utils/whisperService');
const PQueue = require('p-queue').default;

require('dotenv').config();

const userQueues = new Map();
const DELAY_BETWEEN_MESSAGES = 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TIMEOUT = 10000;

function getQueue(userId) {
    if (!userQueues.has(userId)) {
        userQueues.set(userId, new PQueue({ concurrency: 1 }));
    }
    return userQueues.get(userId);
}

async function handleIncomingMessage(client, message) {
    const from = message?.from;
    if (!from) return;

    const queue = getQueue(from);
    queue
        .add(() => processMessage(client, message))
        .then(() => new Promise((res) => setTimeout(res, DELAY_BETWEEN_MESSAGES)))
        .catch((err) => console.error(`❌ Erro na fila de ${from}:`, err));
}

async function processMessage(client, message) {
    const from = message.from;
    const { type, body, decryptFile } = message;

    message.handled = false;

    if (type === 'chat') {
        await handleText(client, from, body, message);
    } else if (type === 'audio') {
        try {
            const buffer = await decryptFile();
            const text = await transcribeAudio(buffer);
            if (!text || text.trim() === '') {
                message.handled = true;
                return await client.sendMessage(from, {
                    text: 'Não consegui entender. Pode repetir? 🥺'
                });
            }
            await handleText(client, from, text, message);
        } catch (err) {
            console.error('❌ Erro ao transcrever áudio:', err);
            message.handled = true;
            return await client.sendMessage(from, {
                text: 'Erro ao entender o áudio. Pode repetir? 🥺'
            });
        }
    }

    if (!message.handled) {
        return await client.sendMessage(from, {
            text: 'Desculpe, não entendi sua mensagem 😅'
        });
    }
}

async function handleText(client, from, text, message) {
    try {
        console.log(`📤 Enviando para webhook: "${text}"`);

        const response = await axios.post(
            WEBHOOK_URL,
            { text, from },
            { timeout: WEBHOOK_TIMEOUT }
        );

        const reply = response.data?.reply;
        if (!reply || reply.trim() === '') return;

        message.handled = true;
        return await client.sendMessage(from, { text: reply });
    } catch (err) {
        console.error('❌ Erro ao comunicar com o webhook:', err.message);
        message.handled = true;
        return await client.sendMessage(from, {
            text: 'Erro ao processar sua mensagem. Tente novamente mais tarde!'
        });
    }
}

module.exports = { handleIncomingMessage };
