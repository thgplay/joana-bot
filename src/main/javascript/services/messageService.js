const axios = require('axios');
const { transcribeAudio } = require('../utils/whisperService');
const PQueue = require('p-queue');

const userQueues = new Map();
const DELAY_BETWEEN_MESSAGES = 3000;

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const WEBHOOK_TIMEOUT = 5000;

function getQueue(userId) {
    if (!userQueues.has(userId)) {
        const queue = new PQueue({ concurrency: 1 });
        userQueues.set(userId, queue);
    }
    return userQueues.get(userId);
}

async function handleIncomingMessage(client, message) {
    const from = message?.from;
    if (!from) {
        console.warn('⚠️ Mensagem sem identificador de usuário:', message);
        return;
    }

    console.log(`📨 Nova mensagem recebida de ${from}`);
    console.log('📦 Conteúdo da mensagem:', {
        type: message.type,
        mimetype: message.mimetype,
        body: message.body,
    });

    const queue = getQueue(from);

    queue.add(() => processMessage(client, message))
        .then(() => new Promise(res => setTimeout(res, DELAY_BETWEEN_MESSAGES)))
        .catch(err => console.error(`❌ Erro na fila de ${from}:`, err));
}

async function processMessage(client, message) {
    const from = message.from;

    switch (message.type) {
        case 'chat':
            console.error(`💬 [${from}] Mensagem de texto: "${message.body}"`);
            print(`test`)
            return await handleText(client, from, message.body);

        case 'audio':
            if (message.mimetype === 'audio/ogg; codecs=opus') {
                console.log(`🎧 [${from}] Mensagem de áudio recebida`);
                try {
                    const buffer = await client.decryptFile(message);
                    const text = await transcribeAudio(buffer);
                    console.log(`📝 [${from}] Áudio transcrito: "${text}"`);
                    if (!text || text.trim() === '') {
                        console.log(`⚠️ [${from}] Transcrição vazia. Enviando resposta de erro.`);
                        return await client.sendText(from, "Que pena! 🥺 Não consegui entender o que você está falando, poderia falar novamente?");
                    }
                    return await handleText(client, from, text);
                } catch (err) {
                    console.error(`❌ [${from}] Erro ao transcrever o áudio:`, err.message);
                    return await client.sendText(from, "Que pena! 🥺 Não consegui entender o que você está falando, poderia falar novamente?");
                }
            }
            break;

        default:
            console.log(`📎 [${from}] Tipo de mensagem não compreendido (${message.type || message.mimetype})`);
            return await client.sendText(from, "Que pena! 🥺 Não consegui entender o que você está falando, poderia falar novamente?");
    }
}

async function handleText(client, from, text) {
    try {
        console.log(`📤 [${from}] Enviando mensagem para webhook: "${text}"`);

        const response = await axios.post(WEBHOOK_URL, {
            text,
            from
        }, { timeout: WEBHOOK_TIMEOUT });

        const reply = response.data?.reply;

        if (!reply || reply.trim() === '') {
            console.log(`⚠️ [${from}] Resposta da IA vazia. Nenhuma mensagem enviada.`);
            return;
        }

        console.log(`📬 [${from}] Resposta gerada pela IA: "${reply}"`);
        await client.sendText(from, reply);
    } catch (err) {
        if (err?.response?.status === 204) {
            console.log(`⚠️ [${from}] Resposta 204 (sem conteúdo). Nenhuma mensagem enviada.`);
            return;
        }



        console.error(`❌ [${from}] Erro ao comunicar com o webhook:`, {
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            data: err?.response?.data,
            message: err?.message,
            stack: err?.stack
        });
    }
}

module.exports = { handleIncomingMessage };
