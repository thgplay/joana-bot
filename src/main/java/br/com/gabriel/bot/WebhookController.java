package br.com.gabriel.bot;

import br.com.gabriel.bot.model.ChatHistory;
import br.com.gabriel.bot.repository.ChatHistoryRepository;
import br.com.gabriel.bot.services.OpenAiService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@RestController
@RequestMapping("/api")
public class WebhookController {

    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);

    private static final long DELAY_MS = 3000L;

    private final ConcurrentHashMap<String, Long> lastSeen = new ConcurrentHashMap<>();

    private final OpenAiService openAiService;
    private final ChatHistoryRepository historyRepository;

    public WebhookController(OpenAiService openAiService, ChatHistoryRepository historyRepository) {
        this.openAiService = openAiService;
        this.historyRepository = historyRepository;
    }

    @PostMapping("/webhook")
    @Async
    public CompletableFuture<ResponseEntity<Map<String, String>>> handleMessage(@RequestBody Map<String, String> payload) {
        logger.info("Requisição recebida no /webhook: {}", payload);

        String message = payload.get("text");
        String sender  = payload.get("from");

        if (sender == null || sender.isBlank()) {
            logger.warn("Payload sem campo 'from'. Ignorando.");
            return CompletableFuture.completedFuture(
                    ResponseEntity.badRequest().body(Map.of("reply", "❌ Erro: usuário não identificado."))
            );
        }

        if (message == null || message.trim().isEmpty()) {
            logger.warn("Mensagem sem texto enviada por: {}", sender);
            return CompletableFuture.completedFuture(
                    ResponseEntity.ok(Map.of("reply", "Desculpe, não consegui entender sua mensagem. Poderia repetir ou dizer quais ingredientes você tem? 🥺"))
            );
        }

        message = message.trim();
        logger.info("Mensagem de texto válida de {}: {}", sender, message);

        /* ---------- ANTISPAM ATÔMICO ---------- */
        long now = System.currentTimeMillis();
        final boolean[] allowed = {false};

        lastSeen.compute(sender, (k, prev) -> {
            if (prev == null || (now - prev) >= DELAY_MS) {
                allowed[0] = true;   // libera processamento
                return now;          // atualiza timestamp
            } else {
                allowed[0] = false;  // ainda dentro da janela -> bloquear
                return prev;         // mantém timestamp anterior
            }
        });

        if (!allowed[0]) {
            logger.warn("Antispam: ignorando requisição de {} ({} ms desde a última).", sender, now - lastSeen.get(sender));
            // 204: silencioso; o Node não envia fallback
            return CompletableFuture.completedFuture(ResponseEntity.noContent().build());
        }
        /* -------------------------------------- */

        // Obter ou criar histórico
        ChatHistory history = historyRepository.findByUserIdWithHistory(sender).orElseGet(() -> {
            ChatHistory novo = new ChatHistory();
            novo.setUserId(sender);
            return novo;
        });

        // Detectar nome, se possível
        String nomeDetectado = extrairNome(message);
        if (nomeDetectado != null && !nomeDetectado.isBlank()) {
            logger.info("Nome detectado: {}", nomeDetectado);
            history.setNome(nomeDetectado);
        }

        history.getHistory().add("Usuário: " + message);

        List<String> last10 = history.getHistory();
        if (last10.size() > 10) {
            last10 = last10.subList(last10.size() - 10, last10.size());
        }

        logger.info("Enviando mensagem para OpenAI com os últimos {} registros...", last10.size());

        return openAiService.ask(sender, history.getNome(), last10, message)
                .thenApply(reply -> {
                    logger.info("Resposta da IA recebida");
                    if (reply == null || reply.isBlank()) {
                        logger.warn("Resposta da IA foi nula ou vazia.");
                        reply = "Desculpe, não consegui encontrar uma receita com essas informações. Pode tentar de outro jeito? 😊";
                    } else {
                        logger.info("Resposta: {}", reply);
                    }
                    history.getHistory().add("Assistente: " + reply);
                    historyRepository.save(history);
                    return ResponseEntity.ok(Map.of("reply", reply));
                })
                .exceptionally(ex -> {
                    logger.error("Erro ao processar resposta da IA", ex);
                    String messageErro = ex.getMessage();
                    String cause = (messageErro != null && !messageErro.isBlank()) ? messageErro : ex.getClass().getSimpleName();
                    return ResponseEntity.status(500).body(
                            Map.of("reply", "❌ Erro ao gerar resposta da IA: " + cause)
                    );
                });
    }


    private String extrairNome(String message) {
        String[] padroes = {
                "meu nome é\\s+", "me chamo\\s+", "sou o\\s+", "sou a\\s+",
                "sou\\s+", "chamo-me\\s+", "aqui é o\\s+", "aqui é a\\s+",
                "aqui é\\s+", "quem fala é o\\s+", "quem fala é a\\s+", "quem fala é\\s+",
                "me apresento como\\s+", "me identifico como\\s+", "pode me chamar de\\s+",
                "pode me chamar\\s+", "o meu nome é\\s+", "o nome é\\s+", "me disseram que me chamo\\s+",
                "acredito que meu nome seja\\s+", "dizem que me chamo\\s+", "oi, sou o\\s+",
                "oi, sou a\\s+", "olá, sou\\s+", "me chamam de\\s+", "me chamam\\s+",
                "sou conhecida como\\s+", "sou conhecido como\\s+", "é o\\s+", "é a\\s+"
        };

        for (String padrao : padroes) {
            if (message.toLowerCase().matches(".*" + padrao + ".*")) {
                return message.replaceAll("(?i).*" + padrao, "").split("\\s+")[0];
            }
        }
        return null;
    }

    private static final String BOT_URL = "http://localhost:3000/api/enviar-mensagem"; // mesmo caminho do Node

    public void enviarMensagem(String texto, String userId) {
        try {
            Map<String, String> payload = Map.of(
                    "from", userId,   // mesma ordem não importa, mas deixei igual ao Node
                    "text", texto
            );

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(BOT_URL))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(
                            new ObjectMapper().writeValueAsString(payload)))
                    .build();

            HttpResponse<String> response = HttpClient
                    .newHttpClient()
                    .send(request, HttpResponse.BodyHandlers.ofString());

            System.out.printf("✅ Resposta do bot: %d - %s%n",
                    response.statusCode(), response.body());

        } catch (Exception e) {
            System.out.println("❌ Erro ao enviar mensagem para " + userId);
            e.printStackTrace();
        }
    }




    @PostMapping("/disparar-para-todos")
    public ResponseEntity<String> dispararMensagemParaTodos() {

        List<ChatHistory> todosUsuarios = historyRepository.findAll().stream()
                .filter(user -> user.getUserId() != null && !user.getUserId().isBlank())
                .toList();

        if (todosUsuarios.isEmpty()) {
            return ResponseEntity.ok("⚠️ Nenhum usuário com userId válido.");
        }

        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        AtomicInteger index = new AtomicInteger();
        int intervaloEmSegundos = 5;

        String promptBase = """
        Você é a Joana, uma assistente de receitas simpática e criativa. Gere uma mensagem acolhedora e variada para convidar o usuário a preparar uma receita hoje.

        🟢 REGRAS FIXAS:
        - Todas as mensagens devem começar com "Oiie!"
        - Sempre inclua "aqui é a Joana" logo no início da mensagem

        🎯 OBJETIVO:
        - Convide o usuário a cozinhar hoje.
        - Estimule a conversa perguntando quais ingredientes ele tem ou se quer sugestões.
        - As mensagens devem parecer escritas por uma pessoa real.

        🔁 VARIAÇÃO:
        - Crie mensagens únicas, sem repetir estruturas ou frases das anteriores.
        - Use 1 a 3 emojis no corpo do texto, com criatividade e moderação.
        - Altere o tom entre divertido, acolhedor, curioso, animado e calmo.
        - Não diga "formato desejável", apenas envie a mensagem final.
        """;

        openAiService.ask("", null, new ArrayList<>(), promptBase).thenAccept(respostaIA -> {
            System.out.println("📢 Iniciando disparo para todos...");

            scheduler.scheduleAtFixedRate(() -> {
                int i = index.getAndIncrement();

                if (i >= todosUsuarios.size()) {
                    scheduler.shutdown();
                    System.out.println("✅ Todos os envios concluídos.");
                    return;
                }

                ChatHistory profile = todosUsuarios.get(i);
                String userId = profile.getUserId();

                try {
                    System.out.println("📨 Enviando para: " + userId);
                    enviarMensagem(respostaIA, userId);
                } catch (Exception e) {
                    System.err.println("❌ Falha ao enviar para " + userId + ": " + e.getMessage());
                }

            }, 0, intervaloEmSegundos, TimeUnit.SECONDS);
        });

        return ResponseEntity.ok("🟢 Disparo agendado para " + todosUsuarios.size() + " usuários.");
    }





}
