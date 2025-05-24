const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const WHISPER_API_KEY = process.env.OPENAI_API_KEY;
const WHISPER_API_URL = process.env.OPENAI_API_URL;



async function transcribeAudio(buffer) {
    const id = Date.now() + '-' + Math.random().toString(36).substring(2, 10);
    const tempPath = path.join(__dirname, '..', `temp-${id}.ogg`);

    try {
        await fs.promises.writeFile(tempPath, buffer);

        const form = new FormData();
        form.append('file', fs.createReadStream(tempPath));
        form.append('model', 'whisper-1');

        const response = await axios.post(WHISPER_API_URL, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${WHISPER_API_KEY}`
            }
        });

        return response.data.text;
    } catch (err) {
        console.error('❌ Erro na transcrição do áudio:', err.message);
        return null;
    } finally {
        if (fs.existsSync(tempPath)) {
            await fs.promises.unlink(tempPath).catch(() => {});
        }
    }
}

module.exports = { transcribeAudio };
