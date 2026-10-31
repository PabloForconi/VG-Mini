# IMÁN — documento de diseño

> Mantené presionado para atraer. Los cristales llegan rápido. Las minas, lento.

## Pitch

Un núcleo en el centro de la pantalla. Cristales y minas cruzan flotando. Mientras
mantenés presionado, el núcleo atrae **todo** lo que está dentro de su campo. Los
cristales son livianos y llegan enseguida; las minas son pesadas y tardan. Si una
mina toca el núcleo, perdés.

Un solo input, una regla que se entiende en 3 segundos y una decisión constante:
*¿suelto ya o aguanto un poco más?*

## Por qué engancha

| Gancho | Cómo aparece en el juego |
| --- | --- |
| **Riesgo/recompensa en cada segundo** | Cuanto más tiempo mantenés, más cristales juntás, pero las minas ya vienen en camino. |
| **Habilidad legible** | La diferencia de masa hace que los toques cortos sean una técnica que se aprende y se nota. |
| **Casi-muertes** | "¡CERCA!" da puntos cuando una mina roza el núcleo y se va. Los sustos se convierten en premio. |
| **Combo con reloj** | El multiplicador (hasta x8) sube cada 4 capturas y se pierde si dejás de atrapar. Castiga ser demasiado conservador. |
| **Reintento instantáneo** | Partidas de 20 a 60 s y un toque para volver a jugar, sin menús. |
| **Récord visible** | "¡NUEVO RÉCORD!" y las monedas ganadas aparecen en la misma pantalla de resultado. |

## Bucle

- **Núcleo (30 s):** tocar / mantener / soltar → combo → muerte.
- **Partida:** puntaje → monedas (1 cada 5 puntos) → récord.
- **Meta (días):** monedas → mejoras y skins → desafíos diarios → volver mañana.

## Modelo de negocio (hybrid-casual)

La mayoría de los ingresos vienen de anuncios con recompensa, que el jugador elige
ver, más compras chicas. Nada de pay-to-win en el puntaje competitivo.

1. **Video con recompensa** (el ingreso principal)
   - *Segunda oportunidad:* al morir, ver un video para borrar las minas en pantalla y seguir. Una vez por partida.
   - *x2 monedas* en la pantalla de resultado.
   - *Cofre diario* con monedas extra.
2. **Interstitial**: solo a partir de la 3.ª partida de la sesión y no más de uno cada 90 s, siempre después de la pantalla de resultado.
3. **Compras dentro de la app**
   - *Quitar anuncios* (interstitials), ~USD 2,99. Los videos con recompensa siguen disponibles.
   - *Pack de inicio:* sin anuncios + monedas + skin exclusiva, una sola vez.
   - *Skins* del núcleo, del campo y de las partículas (puramente cosméticas).
4. **En qué se gastan las monedas:** mejoras con tope (radio del campo +, cristales con imán propio, escudo de 1 golpe al inicio) y skins. Las mejoras hacen sentir progreso sin romper el récord global (la tabla de posiciones puede ir sin mejoras).

## Qué medir en el test

| Métrica | Objetivo para seguir invirtiendo |
| --- | --- |
| Retención D1 | ≥ 40 % |
| Retención D7 | ≥ 12 % |
| Partidas por sesión | ≥ 6 |
| Duración media de partida | 25–60 s |
| Videos con recompensa por usuario activo por día | ≥ 2 |
| CPI en test de creatividades (TikTok/Meta) | < USD 0,50 (Tier 3) / < USD 1 (Tier 1) |

Primero conviene un test de mercado barato: 3 creatividades de 15 s (la tensión de
"aguantá... ¡soltá!" se lee muy bien en video) y medir CTR/CPI antes de invertir en meta.

## Valores de ajuste

Todo está en el objeto `T` de [`src/games/iman.ts`](../src/games/iman.ts). Los más
importantes para el feel:

- `mine.mass` vs `shard.mass` en `KINDS`: la brecha de masa *es* el juego.
- `pullForce`, `pullDecay`: qué tan "pegajoso" se siente el imán.
- `spawnRamp`, `mineRamp`: curva de dificultad (hoy el pico llega a ~50 s).
- `comboWindow`: cuánto perdona el combo.

## Próximos pasos del prototipo

- [ ] Sonido: zumbido del campo que sube de tono mientras mantenés; "tink" por captura, cada vez más agudo con el combo.
- [ ] Vibración (`navigator.vibrate`) en casi-muertes y en la muerte.
- [ ] Prototipo de la segunda oportunidad (sin SDK de anuncios, solo el flujo).
- [ ] Probar variantes: minas que *repelen* al soltar, cristales dorados que solo valen si llegan en combo.
