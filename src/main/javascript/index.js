// index.js
const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcodeTerminal = require('qrcode-terminal'); // imprime no console
const QR = require('qrcode');                      // gera PNG
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
require('dotenv').config();

const { handleIncomingMessage } = require('./services/messageService');
const logger = require('./utils/logger');

// API endpoint para envio externo (mantém hífens ASCII)
const API_PATH = '/api/enviar-mensagem';

// Pastas de logs e autenticação
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info';

/** Garante diretório existente. */
function ensureDirSync(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}

/** Salva QR como PNG e TXT e imprime no terminal. */
async function saveQr(qr) {
  ensureDirSync(LOG_DIR);
  const pngPath = path.join(LOG_DIR, 'whatsapp-qr.png');
  const txtPath = path.join(LOG_DIR, 'whatsapp-qr.txt');

  await fsp.writeFile(txtPath, qr, 'utf8');
  await QR.toFile(pngPath, qr, { margin: 1, scale: 8 });

  try {
    qrcodeTerminal.generate(qr, { small: true });
  } catch {}

  logger.info(`QR code atualizado. PNG: ${pngPath}, TXT: ${txtPath}`);
}

// Handlers globais de erro
process.on('unhandledRejection', (err) => {
  logger.error('UnhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  logger.error('UncaughtException', err);
});

const app = express();
app.use(express.json());

// Referência do socket atual
let sock = null;

/* ------------------------- REST API ------------------------- */
function startApi() {
  app.post(API_PATH, async (req, res) => {
    const { from, text } = req.body;

    if (!sock) {
      return res.status(503).send('❌ Bot ainda não conectado ao WhatsApp.');
    }
    if (!from || !text) {
      return res.status(400).send('❌ Dados inválidos. "from" e "text" são obrigatórios.');
    }

    try {
      await sock.sendMessage(from, { text });
      logger.info(`REST: Enviada mensagem para ${from}: ${text}`);
      res.status(200).send('✅ Mensagem enviada.');
    } catch (err) {
      logger.error('Erro ao enviar mensagem externa', err);
      res.status(500).send('❌ Erro interno ao enviar mensagem.');
    }
  });

  app.listen(3000, '0.0.0.0', () => {
    logger.info(`API externa ativa: http://localhost:3000${API_PATH}`);
  });
}

/* --------------------- WhatsApp bot --------------------- */
async function startBot() {
  ensureDirSync(LOG_DIR);
  ensureDirSync(AUTH_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Usando versão do WhatsApp: ${version}, mais recente? ${isLatest}`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: 'fallback' }),
    browser: ['Joana', 'Ubuntu', '22.04']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    try {
      if (qr) {
        await saveQr(qr);
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.warn(`Conexão fechada. status=${statusCode} | shouldReconnect=${shouldReconnect}`);
        if (shouldReconnect) startBot();
      } else if (connection === 'open') {
        logger.info('Bot conectado!');
      }
    } catch (e) {
      logger.error('Erro no connection.update', e);
    }
  });

  // Mensagens recebidas (normalizadas)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages?.[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const messageType = Object.keys(msg.message)[0];

    const messageObj = {
      from,
      type: messageType,
      body: '',
      mimetype: msg.message?.audioMessage?.mimetype,
      decryptFile: async () => await sock.downloadMediaMessage(msg)
    };

    if (messageType === 'conversation') {
      messageObj.body = msg.message.conversation;
      messageObj.type = 'chat';
    } else if (messageType === 'extendedTextMessage') {
      messageObj.body = msg.message.extendedTextMessage.text;
      messageObj.type = 'chat';
    } else if (messageType === 'audioMessage') {
      messageObj.type = 'audio';
    }

    try {
      await handleIncomingMessage(sock, messageObj);
    } catch (err) {
      logger.error('Erro ao processar mensagem', err);
    }
  });
}

// Encerramento limpo do processo (CTRL+C, container stop, etc.)
function setupShutdownHooks() {
  const shutdown = async (signal) => {
    try {
      logger.info(`Recebido ${signal}, encerrando...`);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/* ----------------- bootstrap ----------------- */
startApi();
startBot();
setupShutdownHooks();
