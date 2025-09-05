const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { v4: uuid } = require('uuid');
const logger = require('./logger');

require('dotenv').config();

/**
 * Transcribe an audio buffer using OpenAI's Whisper API.  This helper writes
 * the buffer to a temporary file because the Whisper API requires a file
 * upload.  Any errors during transcription are logged and result in an
 * empty string being returned.
 *
 * @param {Buffer} buffer Raw audio data.
 * @returns {Promise<string>} The transcribed text or an empty string on error.
 */
async function transcribeAudio(buffer) {
    const filename = `temp-${uuid()}.ogg`;
    const filepath = path.join(__dirname, filename);

    fs.writeFileSync(filepath, buffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(filepath));
    form.append('model', 'whisper-1');

    try {
        const apiUrl = process.env.OPENAI_API_URL;
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiUrl || !apiKey) {
            throw new Error('OPENAI_API_URL ou OPENAI_API_KEY não configurados');
        }
        const response = await axios.post(apiUrl, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${apiKey}`
            }
        });
        return response.data.text;
    } catch (err) {
        const cause = err.response?.data || err.message;
        logger.error('Erro na transcrição', cause instanceof Error ? cause : new Error(String(cause)));
        return '';
    } finally {
        try {
            fs.unlinkSync(filepath);
        } catch {
            // ignore file removal errors
        }
    }
}

module.exports = { transcribeAudio };
