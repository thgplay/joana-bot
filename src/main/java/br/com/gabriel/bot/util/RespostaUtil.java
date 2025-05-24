package br.com.gabriel.bot.util;

import java.time.LocalTime;

public class RespostaUtil {

    public static String gerarSaudacao(LocalTime hora, String nome) {
        String saudacao;
        if (hora.isBefore(LocalTime.NOON)) {
            saudacao = "Bom dia";
        } else if (hora.isBefore(LocalTime.of(18, 0))) {
            saudacao = "Boa tarde";
        } else {

            saudacao = "Boa noite";
        }

        if (nome != null && !nome.isBlank()) {
            return saudacao + ", " + nome + "! ";
        } else {
            return saudacao + "! ";
        }
    }
}
