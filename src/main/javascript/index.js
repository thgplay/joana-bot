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

// API endpoint for sending outbound messages.  Keep ASCII hyphens so the
// endpoint remains stable across different systems.
const API_PATH = '/api/enviar-mensagem';

// Directories for logs and WhatsApp authentication state.  These can be
// overridden via environment variables if needed.
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info';

/** Ensure that a directory exists, creating it (including parents) when
 * necessary.  Ignores errors if the directory already exists. */
function ensureDirSync(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {
    /* noop */
  }
}

/** Persist the QR code for WhatsApp login to both a PNG and a text file.  This
 * helper also prints the QR to the console when running interactively.
 * @param {string} qr The QR code string provided by Baileys. */
async function saveQr(qr) {
  ensureDirSync(LOG_DIR);
  const pngPath = path.join(LOG_DIR, 'whatsapp-qr.png');
  const txtPath = path.join(LOG_DIR, 'whatsapp-qr.txt');

  await fsp.writeFile(txtPath, qr, 'utf8');
  await QR.toFile(pngPath, qr, { margin: 1, scale: 8 });

  // Print QR to the terminal (small) for convenience.  qrcode-terminal
  // gracefully handles being used in non-interactive contexts.
  try {
    qrcodeTerminal.generate(qr, { small: true });
  } catch {}

  logger.info(`QR code updated. PNG: ${pngPath}, TXT: ${txtPath}`);
}

// Attach global error handlers early so that any unexpected exceptions are
// captured and logged rather than silently killing the process.
process.on('unhandledRejection', (err) => {
  logger.error('UnhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  logger.error('UncaughtException', err);
});

const app = express();
app.use(express.json());

// Keep a reference to the WhatsApp socket so that REST requests can send
// messages even if no WebSocket events have fired yet.
let sock = null;

/* ------------------------- REST API ------------------------- */
function startApi() {
  app.post(API_PATH, async (req, res) => {
    const { from, text } = req.body;

    // Validate input and socket state early.  Avoid sending a vague error
    // downstream when we can clearly articulate what is wrong.
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

  // Start the HTTP server.  Use 0.0.0.0 to bind on all interfaces.  This
  // call returns immediately and does not block the rest of the startup.
  app.listen(3000, '0.0.0.0', () => {
    logger.info(`API externa ativa: http://localhost:3000${API_PATH}`);
  });
}

/* --------------------- WhatsApp bot --------------------- */
async function startBot() {
  ensureDirSync(LOG_DIR);
  ensureDirSync(AUTH_DIR);

  // Retrieve stored credentials or start a new session if none exist.
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`Usando versão do WhatsApp: ${version}, mais recente? ${isLatest}`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    // Provide a fallback message for unknown message types
    getMessage: async () => ({ conversation: 'fallback' }),
    browser: ['Joana', 'Ubuntu', '22.04']
  });

  sock.ev.on('creds.update', saveCreds);

  // Connection lifecycle handling.  When disconnected for reasons other than
  // logout, automatically attempt to reconnect.
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

  // Handle incoming messages.  Only process new notifications.  Ignore
  // messages sent by us (fromMe) to avoid echoing.  Convert Baileys
  // message structure into a simpler object for downstream handlers.
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

    // Normalise message types into our own categories.  Additional message
    // types can be added here in future if needed.
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

// Initialise the REST API and then the bot.  The API becomes available
// immediately so that messages queued before the bot is logged in can still
// be accepted and logged.
startApi();
startBot();
