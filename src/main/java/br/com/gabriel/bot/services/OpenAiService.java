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

@Service
public class OpenAiService {

    @Value("${openai.api.url}")
    private String OPENAI_URL;
    private final OkHttpClient client = new OkHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    @Value("${openai.api.key}")
    private String apiKey;

    @Value("${openai.api.model}")
    private String model;

    // Executor dedicado para chamadas OpenAI
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public CompletableFuture<String> ask(String nome, List<String> historico, String mensagemFinal) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                ArrayNode messages = mapper.createArrayNode();

                // Prompt inicial
                ObjectNode systemMessage = mapper.createObjectNode();
                systemMessage.put("role", "system");
                systemMessage.put("content", gerarPromptBase(nome));
                messages.add(systemMessage);

                // Histórico
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

                // Última entrada do usuário
                ObjectNode nova = mapper.createObjectNode();
                nova.put("role", "user");
                nova.put("content", mensagemFinal);
                messages.add(nova);

                // Log de caracteres e estimativa de tokens antes do envio
                String jsonMensagens = messages.toString();
                int totalCaracteres = jsonMensagens.length();
                int estimativaTokens = totalCaracteres / 4;

                ObjectNode body = mapper.createObjectNode();
                body.put("model", model);
                body.set("messages", messages);

                Request request = new Request.Builder()
                        .url(OPENAI_URL)
                        .post(RequestBody.create(mapper.writeValueAsString(body), MediaType.parse("application/json")))
                        .addHeader("Authorization", "Bearer " + apiKey)
                        .build();

                Response response = client.newCall(request).execute();
                String json = response.body().string();

                if (!response.isSuccessful()) {
                    System.out.println("❌ Erro HTTP " + response.code() + ": " + json);
                    return "❌ Erro ao gerar resposta.";
                }

                JsonNode parsed = mapper.readTree(json);
                String resposta = parsed.path("choices").get(0).path("message").path("content").asText();
                JsonNode usage = parsed.path("usage");
                int promptTokens = usage.path("prompt_tokens").asInt();
                int completionTokens = usage.path("completion_tokens").asInt();
                int totalTokens = usage.path("total_tokens").asInt();

                double promptCost = (promptTokens / 1000.0) * 0.0005;
                double completionCost = (completionTokens / 1000.0) * 0.0015;
                double totalCost = promptCost + completionCost;

                System.out.println("📨 Input para IA:");
                System.out.printf("📊 Tokens usados: entrada=%d, saída=%d, total=%d%n", promptTokens, completionTokens, totalTokens);
                System.out.printf("💰 Custo estimado: entrada=%.6f USD, saída=%.6f USD, total=%.6f USD%n", promptCost, completionCost, totalCost);

                return resposta;

            } catch (IOException e) {
                return "❌ Erro ao se comunicar com a OpenAI: " + e.getMessage();
            }
        }, executor);
    }



    private String gerarPromptBase(String nome) {
        try {
            String prompt = Files.readString(Path.of("prompt_joana.txt"), StandardCharsets.UTF_8);

            if (nome != null && !nome.isBlank()) {
                prompt = "O nome do usuário é " + nome + ".\n\n" + prompt;
            }

            return prompt;
        } catch (IOException e) {
            System.err.println("❌ Erro ao carregar prompt_joana.txt: " + e.getMessage());
            return "Você é uma assistente virtual de culinária chamada Joana. Ajude com receitas.";
        }
    }


}
