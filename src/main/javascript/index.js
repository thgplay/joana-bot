const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const qrcode = require('qrcode-terminal');
const { handleIncomingMessage } = require('./services/messageService');

const API_PATH = '/api/enviar-mensagem';   // ✅ hífen ASCII (0x2D)

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

  /* suba a API primeiro — mesmo que o WhatsApp demore a logar  */
  app.listen(3000, '0.0.0.0', () =>
      console.log(`🚀 API externa ativa: http://localhost:3000${API_PATH}`)
  );
}

/* --------------------- WhatsApp bot --------------------- */
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`🟢 Usando versão do WhatsApp: ${version}, mais recente? ${isLatest}`);

  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: 'fallback' }),
    browser: ['Joana', 'Ubuntu', '22.04']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('🔐 Escaneie o QR Code:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
          new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('🔁 Reconectando...', { shouldReconnect });
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot conectado!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
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

startApi();   // 🚨 primeiro a API
startBot();
