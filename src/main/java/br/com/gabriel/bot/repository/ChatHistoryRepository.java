package br.com.gabriel.bot.repository;

import br.com.gabriel.bot.model.ChatHistory;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface ChatHistoryRepository extends MongoRepository<ChatHistory, String> {
    Optional<ChatHistory> findByUserId(String userId);
}
