package br.com.gabriel.bot.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Serviço de integração com a OpenAI usando o modelo “o4‑mini‑high”.
 */
@Service
public class OpenAiService {

    @Value("${openai.api.url}")
    private String OPENAI_URL;

    @Value("${openai.api.key}")
    private String apiKey;

    /**
     * Defina no application.yml / .properties:
     * openai.api.model=o4-mini-high
     */
    @Value("${openai.api.model:o4-mini-high}")
    private String model;

    // custos por 1 000 tokens — o4‑mini‑high (input = US$1.10/M, output = US$4.40/M)
    private static final double INPUT_COST_PER_1K   = 0.00110;
    private static final double OUTPUT_COST_PER_1K  = 0.00440;

    private final OkHttpClient  client   = new OkHttpClient();
    private final ObjectMapper  mapper   = new ObjectMapper();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public CompletableFuture<String> ask(String sender,
                                         String nome,
                                         List<String> historico,
                                         String mensagemFinal) {

        return CompletableFuture.supplyAsync(() -> {
            try {
                ArrayNode messages = mapper.createArrayNode();

                // Mensagem de sistema
                ObjectNode system = mapper.createObjectNode();
                system.put("role", "system");
                system.put("content", gerarPromptBase(nome));
                messages.add(system);

                // Conversa anterior
                for (String linha : historico) {
                    ObjectNode node = mapper.createObjectNode();
                    if (linha.startsWith("Usuário:")) {
                        node.put("role", "user");
                        node.put("content", linha.replaceFirst("Usuário:\\s*", ""));
                    } else if (linha.startsWith("Assistente:")) {
                        node.put("role", "assistant");
                        node.put("content", linha.replaceFirst("Assistente:\\s*", ""));
                    }
                    messages.add(node);
                }

                // Entrada do usuário
                ObjectNode nova = mapper.createObjectNode();
                nova.put("role", "user");
                nova.put("content", mensagemFinal);
                messages.add(nova);

                // Payload
                ObjectNode body = mapper.createObjectNode();
                body.put("model", model);
                body.set("messages", messages);

                Request request = new Request.Builder()
                        .url(OPENAI_URL)
                        .post(RequestBody.create(mapper.writeValueAsString(body),
                                MediaType.parse("application/json")))
                        .addHeader("Authorization", "Bearer " + apiKey)
                        .build();

                Response response = client.newCall(request).execute();
                String json = response.body().string();

                if (!response.isSuccessful()) {
                    System.err.println("❌ HTTP " + response.code() + ": " + json);
                    return "❌ Erro ao gerar resposta.";
                }

                JsonNode parsed = mapper.readTree(json);
                String resposta = parsed.path("choices").get(0)
                        .path("message").path("content").asText();

                JsonNode usage = parsed.path("usage");
                int promptTokens     = usage.path("prompt_tokens").asInt();
                int completionTokens = usage.path("completion_tokens").asInt();
                int totalTokens      = usage.path("total_tokens").asInt();

                double promptCost     = (promptTokens     / 1000.0) * INPUT_COST_PER_1K;
                double completionCost = (completionTokens / 1000.0) * OUTPUT_COST_PER_1K;
                double totalCost      = promptCost + completionCost;

                System.out.printf(
                        "📊 Tokens: prompt=%d, completion=%d, total=%d%n",
                        promptTokens, completionTokens, totalTokens);
                System.out.printf(
                        "💰 Custo: prompt=%.6f USD, completion=%.6f USD, total=%.6f USD%n",
                        promptCost, completionCost, totalCost);

                return resposta;

            } catch (IOException e) {
                e.printStackTrace();
                return "❌ Erro ao se comunicar com a OpenAI: " + e.getMessage();
            }
        }, executor);
    }

    private String gerarPromptBase(String nome) {
        String path = "prompt_joana.txt";
        try {
            String prompt = Files.readString(Path.of(path), StandardCharsets.UTF_8);
            if (nome != null && !nome.isBlank()) {
                prompt = "O nome do usuário é " + nome + ".\n\n" + prompt;
            }
            return prompt;
        } catch (IOException e) {
            System.err.println("❌ Erro ao carregar " + path + ": " + e.getMessage());
            return "Você é uma assistente virtual de culinária chamada Joana. Ajude com receitas.";
        }
    }
}
