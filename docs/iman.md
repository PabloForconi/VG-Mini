# IMÁN — documento de diseño

> Mantené presionado para atraer. Tocá el núcleo para cobrar. Si te toca una mina, perdés lo que no cobraste.

## Pitch

Un núcleo en el centro de la pantalla. Cristales y minas cruzan flotando. Mientras
mantenés presionado, el núcleo atrae **todo** lo que está dentro de su campo. Los
cristales son livianos y llegan enseguida; las minas son pesadas y tardan.

Lo que atrapás queda **guardado dentro del núcleo, sin cobrar**, y el núcleo
**crece**: es un blanco más grande para las minas, pero también atrae más fuerte y
desde más lejos. Tocar el núcleo **cobra** lo guardado con un multiplicador según
la carga, y el núcleo vuelve a su tamaño original. Si una mina te toca, perdés todo
lo que no cobraste y termina la partida.

Dos decisiones constantes: *¿suelto ya o aguanto un poco más?* y *¿cobro ahora o lo
dejo crecer?*

## Cobro por tramos

La carga es cuánto lleva el núcleo (cristal = 1, gema = 3). El multiplicador tiene
que crecer más rápido que el riesgo, si no conviene cobrar siempre y la mecánica
muere.

| Carga | Multiplicador | Color del núcleo |
| --- | --- | --- |
| 0–4 | x1 | blanco |
| 5–9 | x2 | celeste |
| 10–19 | x3 | cian |
| 20–34 | x5 | dorado |
| 35+ | x8 | naranja (tamaño máximo) |

Un anillo alrededor del núcleo muestra cuánto falta para el próximo tramo.

## Por qué engancha

| Gancho | Cómo aparece en el juego |
| --- | --- |
| **Arriesgar o cobrar** | Cada cristal te acerca al próximo multiplicador y a la vez agranda el blanco. La codicia sube la dificultad, no el reloj. |
| **Pérdida visible** | Al morir: "Perdiste 140 sin cobrar". El "casi" es lo que hace apretar reintentar. |
| **Habilidad legible** | La diferencia de masa hace que los toques cortos sean una técnica que se aprende y se nota. |
| **Casi-muertes** | "¡CERCA!" da puntos (directos, sin riesgo) cuando una mina roza el núcleo y se va. |
| **El sonido cuenta la tensión** | Cada captura suena más aguda que la anterior: cuanto más alto, más tenés en juego. Cobrar suena con un arpegio más largo cuanto mayor es el tramo. |
| **Reintento instantáneo** | Partidas de 20 a 90 s y un toque para volver a jugar, sin menús. |

## Controles

- **Mantener fuera del núcleo:** atraer.
- **Tocar el núcleo** (con algo guardado): cobrar. Ese toque no atrae aunque lo mantengas. Con el núcleo vacío, tocarlo atrae como cualquier otro lado, para que el jugador nuevo no se trabe.
- La primera vez que llegás a x2 aparece "TOCÁ EL NÚCLEO PARA COBRAR" hasta que cobrás por primera vez.

## Bucle

- **Núcleo (30 s):** mantener / soltar → cargar → cobrar o morir.
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
- `TIERS`: los cortes y multiplicadores del cobro. Es el número más importante del juego.
- `coreGrowth`, `coreMax`: cuánto castiga crecer.
- `fieldGrowth`, `pullGrowth`: cuánto premia crecer.
- `pullForce`, `pullDecay`: qué tan "pegajoso" se siente el imán.
- `spawnRamp`, `mineRamp`: curva de dificultad (hoy el pico llega a ~50 s).

**A vigilar en el test:** en una simulación con un jugador muy prudente, pasado el
minuto la pantalla se llena de minas y se carga muy lento (de 2 a 21 en 90 s). Si
un humano lo siente avaro, bajar `mineMax` o frenar `mineRamp`.

## Próximos pasos del prototipo

- [ ] Sonido: zumbido del campo que sube de tono mientras mantenés; "tink" por captura, cada vez más agudo con el combo.
- [ ] Vibración (`navigator.vibrate`) en casi-muertes y en la muerte.
- [ ] Prototipo de la segunda oportunidad (sin SDK de anuncios, solo el flujo).
- [ ] Probar variantes: minas que *repelen* al soltar, cristales dorados que solo valen si llegan en combo.
