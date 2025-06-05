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

const app = express();
app.use(express.json());

let sock = null;

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

  sock.ev.on('creds.update', saveCreds); // ✅ Persistência de autenticação

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("🔐 Escaneie o QR Code:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
          new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log("🔁 Reconectando...", { shouldReconnect });
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log("✅ Bot conectado!");
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`📨 Evento 'messages.upsert': tipo=${type}, quantidade=${messages?.length}`);
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const messageType = Object.keys(msg.message)[0];

    console.log(`📥 Mensagem recebida de ${from} - tipo: ${messageType}`);

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

  startApi();
}

function startApi() {
  app.post('/enviar-mensagem', async (req, res) => {
    const { from, text } = req.body;

    if (!sock || !from || !text) {
      return res.status(400).send("❌ Dados inválidos.");
    }

    try {
      await sock.sendMessage(from, { text });
      console.log(`📤 Mensagem enviada para ${from}: ${text}`);
      res.status(200).send("✅ Mensagem enviada.");
    } catch (err) {
      console.error("❌ Erro ao enviar mensagem externa:", err.message);
      res.status(500).send("❌ Erro ao enviar mensagem.");
    }
  });

  app.listen(3000, () => {
    console.log('🚀 API externa ativa: http://localhost:3000/enviar-mensagem');
  });
}

startBot();
