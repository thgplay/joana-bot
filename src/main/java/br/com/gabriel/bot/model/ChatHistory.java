package br.com.gabriel.bot.model;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "chat_history")
public class ChatHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true)
    private String userId;

    private String nome;

    @ElementCollection
    @CollectionTable(name = "chat_messages", joinColumns = @JoinColumn(name = "chat_id"))
    @Column(name = "message")
    private List<String> history = new ArrayList<>();

    // Getters e Setters
}
