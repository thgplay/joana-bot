package br.com.gabriel.bot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class WhatsappBotApplication {

    public static void main(String[] args) {
        SpringApplication.run(WhatsappBotApplication.class, args);
    }

}
