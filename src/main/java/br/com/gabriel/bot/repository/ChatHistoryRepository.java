package br.com.gabriel.bot.repository;

import br.com.gabriel.bot.model.ChatHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ChatHistoryRepository extends JpaRepository<ChatHistory, Long> {

    // Método original
    Optional<ChatHistory> findByUserId(String userId);

    // ✅ Novo método com carregamento forçado da lista `history`
    @Query("SELECT c FROM ChatHistory c LEFT JOIN FETCH c.history WHERE c.userId = :userId")
    Optional<ChatHistory> findByUserIdWithHistory(@Param("userId") String userId);
}
