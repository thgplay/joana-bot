const venom = require('venom-bot');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const WHISPER_API_KEY = process.env.OPENAI_API_KEY;
const WHISPER_API_URL = process.env.OPENAI_API_URL;
const RESPONSE_URL = process.env.RESPONSE_URL

let venomClient = null;

// 🟢 Inicializa o Venom
venom
    .create({ session: 'meubot', headless: false })
    .then((client) => {
      venomClient = client;
      start(client);
      startApi();
    })
    .catch((error) => console.error('Erro ao iniciar o bot:', error));

// 🎯 Lógica de mensagens recebidas
function start(client) {
  client.onMessage(async (message) => {
    try {
      if (!message.isGroupMsg) {
        const from = message.from;

        if (message.type === 'chat') {
          await processText(message.body, from, client);
        }

        if (message.mimetype === 'audio/ogg; codecs=opus') {
          const buffer = await client.decryptFile(message);
          const transcription = await transcribeAudio(buffer);

          if (!transcription) {
            return await client.sendText(from, '❌ Erro ao transcrever o áudio.');
          }

          await processText(transcription, from, client);
        }
      }
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
      await client.sendText(message.from, '❌ Erro interno. Tente novamente mais tarde.');
    }
  });
}

// 📤 Função para processar texto do usuário
async function processText(text, from, client) {
  try {
    const response = await axios.post(RESPONSE_URL, {
      text,
      from
    });

    const reply = response.data?.reply;
    if (!reply || reply.trim() === '') return;

    await client.sendText(from, reply);
  } catch (err) {
    console.error('Erro no webhook:', err.message);
    await client.sendText(from, 'Desculpe, não consegui entender sua mensagem. Poderia repetir ou dizer quais ingredientes você tem? 🥺');
  }
}

// 🎧 Transcrição com Whisper
async function transcribeAudio(buffer) {
  try {
    const tempPath = './temp-audio.ogg';
    fs.writeFileSync(tempPath, buffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(tempPath));
    form.append('model', 'whisper-1');

    const response = await axios.post(WHISPER_API_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${WHISPER_API_KEY}`
      }
    });

    fs.unlinkSync(tempPath);
    return response.data.text;
  } catch (err) {
    console.error('Erro na transcrição de áudio:', err.message);
    return null;
  }
}

// 🌐 API para envio de mensagem externa (usada pelo Spring)
function startApi() {
  app.post('/enviar-mensagem', async (req, res) => {
    const { from, text } = req.body;

    if (!venomClient || !from || !text) {
      return res.status(400).send("❌ Dados inválidos.");
    }

    try {
      await venomClient.sendText(from, text);
      console.log(`📤 Mensagem enviada para ${from}: ${text}`);
      res.status(200).send("✅ Mensagem enviada.");
    } catch (err) {
      console.error("❌ Erro ao enviar mensagem externa:", err.message);
      res.status(500).send("❌ Erro ao enviar mensagem.");
    }
  });

  app.listen(3000, () => {
    console.log('🚀 API de envio externo ativa em http://localhost:3000/enviar-mensagem');
  });
}
