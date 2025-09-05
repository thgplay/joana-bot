package br.com.gabriel.bot;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import java.util.concurrent.Executor;

@SpringBootApplication
@EnableAsync
public class WhatsappBotApplication {

    public static void main(String[] args) {
        SpringApplication.run(WhatsappBotApplication.class, args);
    }

    /**
     * Configura um executor assíncrono dedicado para métodos anotados com
     * {@link org.springframework.scheduling.annotation.Async}.  Ajuste os
     * valores de corePoolSize, maxPoolSize e queueCapacity conforme a
     * capacidade do servidor.  Aqui definimos números generosos para
     * atender até 1000 usuários simultâneos sem travar a aplicação.  Use
     * monitoramento para ajustar esses valores em produção.
     */
    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(20);
        executor.setMaxPoolSize(100);
        executor.setQueueCapacity(1000);
        executor.setThreadNamePrefix("AsyncExecutor-");
        executor.initialize();
        return executor;
    }

}
