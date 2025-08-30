package br.com.gabriel.bot.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;

@Service
public class OpenAiService {

    @Value("${openai.api.url}")
    private String OPENAI_URL; // ex.: https://api.openai.com/v1/chat/completions

    @Value("${openai.api.key}")
    private String apiKey;

    /**
     * ⚠️ Troquei o default para "o4-mini" (o "o4-mini-high" não é público e pode causar erro/latência).
     * Defina no application.properties:
     *   openai.api.model=o4-mini
     */
    @Value("${openai.api.model:o4-mini}")
    private String model;

    // (Opcional) custos estimados – ajuste se quiser usar para log/finanças
    private static final double INPUT_COST_PER_1K  = 0.00110; // ajuste ou remova se não usar
    private static final double OUTPUT_COST_PER_1K = 0.00440; // ajuste ou remova se não usar

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    // Timeouts robustos + ping HTTP/2 + retryOnConnectionFailure
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(Duration.ofSeconds(30))
            .callTimeout(Duration.ofSeconds(180))
            .writeTimeout(Duration.ofSeconds(60))
            .readTimeout(Duration.ofSeconds(120))
            .pingInterval(Duration.ofSeconds(15))
            .retryOnConnectionFailure(true)
            // Se sua rede/proxy tiver problema com HTTP/2, descomente a linha abaixo:
            // .protocols(java.util.Arrays.asList(Protocol.HTTP_1_1))
            .build();

    private final ObjectMapper mapper = new ObjectMapper();

    // Virtual threads para I/O (ok no Java 21+); limite um pouco para evitar “tempestade” de conexões
    private final ExecutorService executor = Executors.newThreadPerTaskExecutor(Thread.ofVirtual().factory());

    // Limite de mensagens antigas para reduzir latência/timeout
    private static final int MAX_HISTORY_MESSAGES = 6; // pegue só os últimos 6 itens do histórico

    // Parametrização para respostas mais rápidas/estáveis
    private static final int    MAX_TOKENS   = 700;
    private static final double TEMPERATURE  = 0.3;

    public CompletableFuture<String> ask(String sender,
                                         String nome,
                                         List<String> historico,
                                         String mensagemFinal) {

        return CompletableFuture.supplyAsync(() -> {
            try {
                // 1) Monte as mensagens limitando o histórico
                ArrayNode messages = mapper.createArrayNode();

                // system
                ObjectNode system = mapper.createObjectNode();
                system.put("role", "system");
                system.put("content", gerarPromptBase(nome));
                messages.add(system);

                // histórico (somente os N últimos)
                List<String> historicoRecente = recortarHistorico(historico, MAX_HISTORY_MESSAGES);
                for (String linha : historicoRecente) {
                    String trimmed = linha == null ? "" : linha.trim();
                    if (trimmed.isEmpty()) continue;

                    ObjectNode node = mapper.createObjectNode();
                    if (trimmed.startsWith("Usuário:")) {
                        node.put("role", "user");
                        node.put("content", trimmed.replaceFirst("Usuário:\\s*", ""));
                        messages.add(node);
                    } else if (trimmed.startsWith("Assistente:")) {
                        node.put("role", "assistant");
                        node.put("content", trimmed.replaceFirst("Assistente:\\s*", ""));
                        messages.add(node);
                    }
                }

                // última mensagem do usuário
                ObjectNode nova = mapper.createObjectNode();
                nova.put("role", "user");
                nova.put("content", mensagemFinal == null ? "" : mensagemFinal);
                messages.add(nova);

                // 2) Payload enxuto
                ObjectNode body = mapper.createObjectNode();
                body.put("model", model);
                body.set("messages", messages);
//                body.put("max_completion_tokens", MAX_TOKENS);   // ✅ correto p/ O-series


                Request request = new Request.Builder()
                        .url(OPENAI_URL)
                        .addHeader("Authorization", "Bearer " + apiKey)
                        .addHeader("Content-Type", "application/json")
                        .post(RequestBody.create(mapper.writeValueAsString(body), JSON))
                        .build();

                long t0 = System.nanoTime();
                try (Response response = executeWithRetry(client, request, 3)) {
                    long t1 = System.nanoTime();
                    double ms = (t1 - t0) / 1_000_000.0;

                    if (response == null) {
                        return "❌ Erro: resposta nula da OpenAI.";
                    }

                    String json = response.body() != null ? response.body().string() : "";
                    int code = response.code();

                    if (!response.isSuccessful()) {
                        System.err.println("❌ HTTP " + code + ": " + json);
                        String msg = extrairMensagemErro(json);
                        return "❌ Erro ao gerar resposta (" + code + "): " + msg;
                    }

                    JsonNode parsed = mapper.readTree(json);
                    // Chat Completions:
                    // choices[0].message.content
                    String resposta = parsed.path("choices").path(0).path("message").path("content").asText(null);

                    // Se estiver usando outro endpoint/modelo, adapte aqui.
                    if (resposta == null || resposta.isBlank()) {
                        // fallback para "text" em alguns modelos
                        resposta = parsed.path("choices").path(0).path("text").asText("");
                    }

                    // usage (pode não vir em alguns casos)
                    JsonNode usage = parsed.path("usage");
                    int promptTokens     = usage.path("prompt_tokens").asInt(-1);
                    int completionTokens = usage.path("completion_tokens").asInt(-1);
                    int totalTokens      = usage.path("total_tokens").asInt(-1);

                    // Logs úteis
                    System.out.printf("⏱️ Latência OpenAI: %.1f ms%n", ms);
                    if (promptTokens >= 0) {
                        double promptCost     = (promptTokens     / 1000.0) * INPUT_COST_PER_1K;
                        double completionCost = (completionTokens / 1000.0) * OUTPUT_COST_PER_1K;
                        double totalCost      = promptCost + completionCost;

                        System.out.printf(
                                "📊 Tokens: prompt=%d, completion=%d, total=%d%n",
                                promptTokens, completionTokens, totalTokens
                        );
                        System.out.printf(
                                "💰 Custo (estimado): prompt=%.6f USD, completion=%.6f USD, total=%.6f USD%n",
                                promptCost, completionCost, totalCost
                        );
                    }

                    if (resposta == null || resposta.isBlank()) {
                        return "❌ A OpenAI retornou uma resposta vazia.";
                    }
                    return resposta;
                }

            } catch (Exception e) {
                e.printStackTrace();
                String msg = e.getMessage();
                if (e instanceof SocketTimeoutException) {
                    return "❌ Timeout ao se comunicar com a OpenAI. Tente novamente em alguns segundos.";
                }
                return "❌ Erro ao se comunicar com a OpenAI: " + (msg == null ? e.getClass().getSimpleName() : msg);
            }
        }, executor);
    }

    /** Limita o histórico aos N últimos itens, evitando payloads gigantes. */
    private List<String> recortarHistorico(List<String> historico, int max) {
        if (historico == null || historico.isEmpty()) return List.of();
        int size = historico.size();
        if (size <= max) return new ArrayList<>(historico);
        return new ArrayList<>(historico.subList(size - max, size));
    }

    /** Retry simples com backoff exponencial para falhas transitórias (timeout, IO, 429, 5xx). */
    private Response executeWithRetry(OkHttpClient client, Request request, int maxAttempts) throws IOException {
        int attempt = 0;
        long backoffMs = 800;

        while (true) {
            attempt++;
            try {
                Response resp = client.newCall(request).execute();
                int code = resp.code();

                if (code == 429 || code >= 500) {
                    if (attempt < maxAttempts) {
                        safeClose(resp);
                        sleep(backoffMs);
                        backoffMs *= 2;
                        continue;
                    }
                }
                return resp; // sucesso ou erro "final"
            } catch (IOException e) {
                if (attempt < maxAttempts) {
                    sleep(backoffMs);
                    backoffMs *= 2;
                    continue;
                }
                throw e;
            }
        }
    }

    private void safeClose(Response resp) {
        try {
            if (resp != null && resp.body() != null) resp.close();
        } catch (Exception ignored) {}
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    /** Extrai uma mensagem de erro legível do JSON de erro da API (quando possível). */
    private String extrairMensagemErro(String json) {
        try {
            JsonNode node = mapper.readTree(json);
            String msg = node.path("error").path("message").asText(null);
            if (msg != null && !msg.isBlank()) return msg;
            return json != null && !json.isBlank() ? json : "Erro desconhecido.";
        } catch (Exception e) {
            return json != null && !json.isBlank() ? json : "Erro desconhecido.";
        }
    }

    private String gerarPromptBase(String nome) {
        String path = "prompt_joana.txt"; // ajuste o caminho se necessário
        try {
            String prompt = Files.readString(Path.of(path), StandardCharsets.UTF_8);
            if (nome != null && !nome.isBlank()) {
                prompt = "O nome do usuário é " + nome + ".\n\n" + prompt;
            }
            return prompt;
        } catch (IOException e) {
            System.err.println("❌ Erro ao carregar " + path + ": " + e.getMessage());
            return "Você é uma assistente virtual de culinária chamada Joana. Ajude com receitas, use PT-BR, unidades em gramas/ml, destaque alergênicos e permita ajuste de porções.";
        }
    }
}
