const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { v4: uuid } = require('uuid');

require('dotenv').config();

async function transcribeAudio(buffer) {
    const filename = `temp-${uuid()}.ogg`;
    const filepath = path.join(__dirname, filename);

    fs.writeFileSync(filepath, buffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(filepath));
    form.append('model', 'whisper-1');

    try {
        const response = await axios.post(process.env.OPENAI_API_URL, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });
        return response.data.text;
    } catch (err) {
        console.error("Erro na transcrição:", err.response?.data || err.message);
        return '';
    } finally {
        fs.unlinkSync(filepath);
    }
}

module.exports = { transcribeAudio };
