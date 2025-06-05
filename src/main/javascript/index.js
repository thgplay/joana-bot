require('dotenv').config();
const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { handleIncomingMessage } = require('./services/messageService');
const path = require('path');
const fs = require('fs');

const { state, saveState } = useSingleFileAuthState('./auth_info.json');

async function startSock() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    syncFullHistory: false,
    getMessage: async () => ({ conversation: "fallback" })
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !messages || !messages[0]) return;

    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    try {
      await handleIncomingMessage(sock, msg);
    } catch (err) {
      console.error('❌ Erro ao processar mensagem:', err);
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`🔌 Conexão encerrada. Código: ${reason}`);

      if (reason === DisconnectReason.loggedOut) {
        console.log("❌ Sessão encerrada. Delete o auth_info.json para nova conexão.");
      } else {
        console.log("🔄 Reconectando...");
        startSock();
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado!');
    }
  });
}

startSock();
