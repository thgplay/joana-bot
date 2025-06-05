# 🤖 Joana Bot – Assistente de Receitas no WhatsApp

Joana é uma assistente automatizada que conversa via WhatsApp, entende mensagens de texto ou áudio, transcreve os áudios com Whisper, e responde usando inteligência artificial (OpenAI). A comunicação entre o bot e a IA é feita via webhook em uma API Java.

---

## 🧰 Requisitos

- Node.js v20+ (recomendado v22)
- Java (para rodar a API que recebe os webhooks)
- MySQL com suporte a `utf8mb4`
- Git
- Conta no [OpenAI](https://platform.openai.com)
- Conta no GitHub (para usar o webhook opcional)

---

## 📦 Instalação

1. Clone o repositório:

```bash
git clone https://github.com/seu-usuario/joana-bot.git
cd joana-bot/src/main/javascript
```

2. Instale as dependências:

```bash
npm install
```

3. Crie um arquivo `.env` com o seguinte conteúdo:

```
WEBHOOK_URL=http://localhost:8080/api/webhook
OPENAI_API_KEY=sua-chave-openai
OPENAI_API_URL=https://api.openai.com/v1/audio/transcriptions
```

4. Execute o bot:

```bash
node index.js
```

---

## 🛠️ Configuração do banco de dados (MySQL)

Garanta que a tabela `chat_messages` use `utf8mb4` para suportar emojis:

```sql
ALTER TABLE chat_messages CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE chat_messages MODIFY message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 📲 Primeira execução

Ao rodar `node index.js` pela primeira vez:

- Será exibido um QR Code no terminal.
- Escaneie com o WhatsApp Web do seu celular.
- O estado de autenticação será salvo na pasta `auth_info/`.

Se você reiniciar o bot, **não será necessário escanear novamente**, desde que a pasta `auth_info/` seja mantida.

---

## 📤 Envio de mensagens pela API

Você pode enviar mensagens manualmente via:

```http
POST http://localhost:3000/enviar-mensagem
Content-Type: application/json

{
  "from": "5534999999999@c.us",
  "text": "Olá, tudo bem?"
}
```

---

## 🔁 Atualização automática via GitHub Webhook

Você pode configurar um webhook no GitHub apontando para:

```
http://<IP ou domínio da sua VPS>:3001/webhook
```

### Script de atualização (`update-joana.bat`):

```bat
@echo off
cd /d C:\caminho\do\joana-bot
git reset --hard
git clean -fd
git pull origin main
```

---

## 📎 Organização do projeto

```
joana-bot/
├── index.js                # Entrypoint principal
├── .env                    # Variáveis de ambiente
├── auth_info/              # Dados da sessão do WhatsApp
├── services/
│   └── messageService.js   # Tratamento das mensagens
├── utils/
│   └── whisperService.js   # Transcrição de áudio
└── webhook-joana.js        # Servidor para atualização automática via webhook
```

---

## 🧠 Integração com OpenAI

O prompt principal está salvo em:  
`prompt_joana.txt`

> Esse arquivo é carregado pela API Java para gerar respostas naturais e empáticas baseadas no histórico de conversa.

---

## 🧪 Teste local

- Certifique-se de que o bot está rodando (`node index.js`)
- Envie uma mensagem de outro número para testar o histórico e a resposta
- Observe o terminal para logs de envio, transcrição e chamadas de webhook

---

## 🛡️ Segurança

- Não compartilhe a pasta `auth_info` com ninguém.
- Configure um token secreto no webhook para verificar a autenticidade (`x-hub-signature-256`).
- Use firewall para proteger a porta `3001` caso o webhook esteja público.

---

## 📬 Contato

Feito por Gabriel – para suporte ou melhorias, envie um PR ou mensagem.

---
