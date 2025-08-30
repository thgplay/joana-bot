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

const API_PATH = '/api/enviar-mensagem'; // ✅ hífen ASCII (0x2D)
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs'); // ex.: C:\Apps\Joana\logs
const AUTH_DIR = process.env.AUTH_DIR || 'auth_info';                    // persistência do login

// helpers
function ensureDirSync(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

async function saveQr(qr) {
  ensureDirSync(LOG_DIR);
  const pngPath = path.join(LOG_DIR, 'whatsapp-qr.png');
  const txtPath = path.join(LOG_DIR, 'whatsapp-qr.txt');

  await fsp.writeFile(txtPath, qr, 'utf8');
  await QR.toFile(pngPath, qr, { margin: 1, scale: 8 });

  // imprime no terminal quando houver (útil em execução interativa)
  try { qrcodeTerminal.generate(qr, { small: true }); } catch {}

  console.log(`🔐 QR atualizado:`);
  console.log(`   • PNG: ${pngPath}`);
  console.log(`   • TXT: ${txtPath}`);
}

process.on('unhandledRejection', (err) => {
  console.error('❌ UnhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ UncaughtException:', err);
});

const app = express();
app.use(express.json());

let sock = null;

/* ------------------------- REST ------------------------- */
function startApi() {
  app.post(API_PATH, async (req, res) => {
    const { from, text } = req.body;

    if (!sock || !from || !text) {
      return res.status(400).send('❌ Dados inválidos.');
    }

    try {
      await sock.sendMessage(from, { text });
      console.log(`📤 Mensagem enviada para ${from}: ${text}`);
      res.status(200).send('✅ Mensagem enviada.');
    } catch (err) {
      console.error('❌ Erro ao enviar mensagem externa:', err.message);
      res.status(500).send('❌ Erro ao enviar mensagem.');
    }
  });

  // suba a API primeiro — mesmo que o WhatsApp demore a logar
  app.listen(3000, '0.0.0.0', () =>
      console.log(`🚀 API externa ativa: http://localhost:3000${API_PATH}`)
  );
}

/* --------------------- WhatsApp bot --------------------- */
async function startBot() {
  ensureDirSync(LOG_DIR);
  ensureDirSync(AUTH_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`🟢 Usando versão do WhatsApp: ${version}, mais recente? ${isLatest}`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false, // nós controlamos a impressão/log do QR
    getMessage: async () => ({ conversation: 'fallback' }),
    browser: ['Joana', 'Ubuntu', '22.04']
    // Dica: para logs verbosos do Baileys, rode com DEBUG=baileys:* no ambiente
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
        console.log(`🔁 Conexão fechada. status=${statusCode} | shouldReconnect=${shouldReconnect}`);
        if (shouldReconnect) startBot();
      } else if (connection === 'open') {
        console.log('✅ Bot conectado!');
      }
    } catch (e) {
      console.error('❌ Erro no connection.update:', e);
    }
  });

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
      console.error('❌ Erro ao processar mensagem:', err);
    }
  });
}

startApi(); // 🚨 primeiro a API
startBot();
