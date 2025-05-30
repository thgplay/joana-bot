package br.com.gabriel.bot.repository;

import br.com.gabriel.bot.model.ChatHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ChatHistoryRepository extends JpaRepository<ChatHistory, Long> {
    Optional<ChatHistory> findByUserId(String userId);
}
