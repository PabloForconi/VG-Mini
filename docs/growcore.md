# GROWCORE — documento de diseño

> Mantené para atraer. Tocá el núcleo para liberar la carga. ¡Cuidado con las bombas!

## Pitch

Un núcleo en el centro de la pantalla. Cristales y minas cruzan flotando. Mientras
mantenés presionado, el núcleo atrae **todo** lo que está dentro de su campo. Cuanto
más pesado algo, más tarda en llegar.

Lo que atrapás queda **guardado dentro del núcleo, sin cobrar**, y el núcleo
**crece**: es un blanco más grande para las minas, pero también atrae más fuerte y
desde más lejos. Tocar el núcleo **cobra** lo guardado con un multiplicador según
la carga, y el núcleo vuelve a su tamaño original. Si una mina te toca, perdés todo
lo que no cobraste y termina la partida.

Dos decisiones constantes: *¿suelto ya o aguanto un poco más?* y *¿cobro ahora o lo
dejo crecer?*

## Ítems: escalera de riesgo

> En el juego, la mina se llama **Bomba** y las gemas son **cristales** (Celestina, Citrino y Rodonita). En el código siguen siendo `mine`, `cyan`, `yellow` y `pink`. El escudo pizza se llama **Super Escudo**.

| Ítem | Peso | Puntos | Carga |
| --- | --- | --- | --- |
| Celestina (celeste) | 1 | 1 | 1 |
| Citrino (amarillo) | 2 | 5 | 2 |
| Rodonita (rosa) | 3 | 15 | 3 |
| Mina | 3,4 | perdés lo no cobrado | — |
| Cristal falso (3 tamaños) | 1, 2 o 3 (igual que la real) | perdés lo no cobrado | — |

La Rodonita pesa casi lo mismo que una mina: para traerla tenés que mantener tanto
como para arrastrar una mina también. Cada rosa en pantalla es un "¿me la juego?".

La pantalla de inicio muestra esta tabla al estilo arcade: las filas aparecen una
por una, con una barra de peso que deja la rosa visualmente pegada a la mina.

## Fases

Cada fase introduce **una sola cosa**, con un cartel ("¡NUEVO CRISTAL!" o "¡NUEVO
ESCUDO!" con ícono, "¡CAOS!"). Cuando entra algo nuevo, es lo primero que aparece
en esa fase, así el jugador lo ve mientras está el cartel. Arriba, debajo del
puntaje, se ve "FASE N".

| Fase | Desde | Mezcla cada 10 apariciones | Una aparición cada | Escudos al azar |
| --- | --- | --- | --- | --- |
| 1 | 0 s | 8 celestes, 2 minas | 0,8 s | — |
| 2 — ¡NUEVO CRISTAL! Citrino | 15 s | 5 celestes, 2 amarillas, 3 minas | 0,7 s | — |
| 3 — ¡NUEVO ESCUDO! Escudo | 35 s | 4 celestes, 2 amarillas, 4 minas | 0,6 s | simple |
| 4 — ¡NUEVO CRISTAL! Rodonita | 55 s | 3 celestes, 2 amarillas, 1 rosa, 4 minas | 0,5 s | simple |
| 5 — ¡NUEVO ESCUDO! Super Escudo | 80 s | 3 celestes, 2 amarillas, 1 rosa, 4 minas | 0,45 s | simple o pizza |
| 6 — ¡CAOS! | 105 s | 2 celestes, 2 amarillas, 1 rosa, 5 minas | 0,36 s | simple o pizza |
| 7 — ¡CRISTALES FALSOS! | 135 s | 2 celestes, 2 amarillas, 1 rosa, 4 minas, 1 falsa grande | 0,36 s | simple o pizza |
| 8 (sin cartel) | 160 s | 2 celestes, 2 amarillas, 1 rosa, 3 minas, 1 falsa grande, 1 falsa mediana | 0,36 s | simple o pizza |
| 9 (sin cartel) | 185 s | 2 celestes, 2 amarillas, 1 rosa, 2 minas, 1 falsa de cada tamaño | 0,36 s | simple o pizza |

**Bolsa en vez de dado:** las apariciones se reparten de una bolsa mezclada con la
mezcla de la fase, así las proporciones se cumplen siempre (sin rachas raras ni
minutos sin rosas). Además nunca salen más de 2 mortales seguidos (minas o cristales falsos); un escudo corta la racha. La velocidad de los
cristales sigue subiendo de a poco con el tiempo.

## Cristales falsos

Desde la fase 7 aparecen **cristales falsos**: bombas disfrazadas. Son rojos, con la
silueta dentada de la "gema maldita" (8 puntas) y del mismo tamaño que el cristal
bueno que imitan: grande (Rodonita), mediano (Citrino) y pequeño (Celestina). Pesan
**lo mismo** que su cristal real, así que el peso no las delata: hay que mirarlas.
Atraer una es igual que atraer una mina (los escudos también las paran).

Entran de a una por fase, primero la más pesada: la grande en la 7 (con el cartel
"¡CRISTALES FALSOS!", que explica la idea), el mediano en la 8 y el pequeño en la 9.
Las fases 8 y 9 no tienen cartel ni fanfarria: solo sube el número de fase y la
falsa nueva es lo primero que aparece (o lo segundo, si justo venían 2 mortales
seguidos). Las falsas reemplazan minas, así que la proporción de mortales se
mantiene en 5 de cada 10.

## Escudos

Se atraen como cualquier ítem y pesan menos que una mina para que valga la pena ir a buscarlos: el Escudo **2,2** (entre Citrino y Rodonita) y el Super Escudo **2,7**. Igual traer
uno es tan arriesgado como traer una mina. No suman puntos ni carga. Al atraparlo
aparece una burbuja alrededor del núcleo que crece con él.

| Escudo | Ícono | Qué hace |
| --- | --- | --- |
| Escudo | redondo blanco | La primera mina que toca la burbuja explota sin hacerte nada; la burbuja se rompe. |
| Super Escudo (pizza) | redondo, 6 porciones que cambian de color | La burbuja (blanca, como la del simple) tiene 6 porciones. Una mina rompe solo la porción por donde entra; las otras siguen protegiendo. Una mina que entra por un hueco te toca. |

- El primero de cada tipo llega con su cartel (Escudo a los 35 s, Super Escudo a los 80 s). El Escudo va antes que la Rodonita: por peso queda entre Citrino y Rodonita, y la primera protección llega justo antes de la jugada más riesgosa. Después caen al azar cada 10–18 s.
- Agarrar un escudo teniendo otro lo reemplaza por el nuevo, completo.
- Cobrar no saca el escudo; morir sí.

## Cobro por tramos

La carga es cuánto lleva el núcleo (ver tabla de ítems). El multiplicador tiene
que crecer más rápido que el riesgo, si no conviene cobrar siempre y la mecánica
muere.

| Carga | Multiplicador | Color del núcleo |
| --- | --- | --- |
| 0–4 | x1 | crema |
| 5–9 | x2 | menta |
| 10–19 | x3 | verde agua |
| 20–34 | x5 | dorado |
| 35+ | x8 | coral (tamaño máximo) |

Un anillo alrededor del núcleo muestra cuánto falta para el próximo tramo.

### Onda expansiva

Cobrar suelta una onda que sale del borde del núcleo y **empuja hacia afuera todo lo
que toca**: cristales, minas, falsos y escudos. Sirve para salvarte de una mina que
estaba por entrar, a cambio de alejar también los cristales cercanos.

- La onda viaja (`waveSpeed`, 700 px/s) y empuja a cada ítem una sola vez, cuando el frente le llega.
- Es un impulso: todos reciben el mismo, así que la velocidad que ganan es impulso / masa. Una Celestina sale volando; una mina (3,4) apenas se corre.
- El empujón se apaga a lo largo del alcance: máximo pegado al núcleo, nada en el borde de la onda.
- Escala con el tamaño del núcleo al cobrar: con el más chico llega a 110 px del borde con impulso 520; con el máximo, a 300 px con impulso 1352 (`waveReach`, `waveReachGrowth`, `waveImpulse`, `waveImpulseGrowth`).
- Lo empujado frena igual que lo atraído (`pullDecay`): recorre en total velocidad / 2,4. Ejemplo: una mina a 12 px del borde de un núcleo máximo sale a ~370 px/s y se aleja ~150 px.
- Si la onda saca una mina del anillo de peligro, cuenta como "¡CERCA!".

## Estética

Noche en el espacio con formas planas en pastel, en el espíritu de las escenas
nocturnas de juegos como Monument Valley (sin copiar nada puntual). **Sin formas
edilicias.**

- **Cielo** índigo profundo en degradé, dos nebulosas muy tenues (verde agua y magenta) y estrellas que titilan; unas pocas son destellos de 4 puntas.
- **Núcleo**: círculo pastel con brillo, que cambia de tono con el tramo (crema → menta → verde agua → dorado → coral). El número va en tinta oscura.
- **Gemas**: cristales facetados en dos tonos, sin giro, con brillo suave de su color. Mientras el imán las arrastra **se inclinan hacia donde van** (más rápido = más inclinación: celeste hasta 20°, amarilla ~13°, rosa ~6°) y al soltar vuelven a quedar derechas (`tiltMax`, `tiltSpeed`).
- **Minas**: silueta de mina naval **facetada en rojos** (cuerpo tallado en 8 caras, 8 pinchos piramidales y un centro redondo), con sombreado plano y la luz siempre arriba a la izquierda aunque gire. Late apenas y tiene un halo rojo tenue. Se pre-dibuja como imagen en 16 pasos de giro (ver *Rendimiento*).
- **Encendido**: al empezar cada partida el núcleo se prende como una tele vieja (`BOOT`, ~0,8 s): un haz horizontal y uno vertical se achican hacia el centro, se cruzan en un destello de 4 puntas y ese punto crece hasta ser el núcleo, primero blanco y enfriándose a su color.
- **Cobro**: las partículas del cobro salen disparadas lejos (en un cobro grande llegan a los bordes); las de cada captura quedan cerca del núcleo. La onda expansiva se ve como un anillo del color del tramo que se abre, se afina y se apaga.
- **Escudos**: burbujas blancas con brillo. El ícono pizza es de un solo color plano que cambia suave en ciclo (blanco → rosa → amarillo → verde → celeste → lila), sin divisiones: la misma burbuja transparente que el simple, pero teñida (relleno y borde) con el color que va cambiando.
- **Texto**: Josefin Sans en tonos claros, títulos con espaciado amplio.

Los colores están en `C`, `KINDS` y `TIERS` de
[`src/games/growcore.ts`](../src/games/growcore.ts); el cielo en `STARS` y `NEBULAE`.

## Música y sonido

Todo el audio es sintetizado en vivo (WebAudio, sin archivos), en La menor sobre
La m – Fa – Do – Sol, así comparte notas con las campanas de captura (pentatónica de Do)
y nunca desafina contra ellas. Estilo buscado: etéreo y espacial (tipo Monument Valley):
campanas de vidrio, colchones que crecen despacio y aire, casi todo pasando por una
reverb de sala compartida. Código: `src/engine/audio.ts` (síntesis, reverb, `bell`,
`Shimmer`), `src/engine/music.ts` (secuenciador), `src/games/growcore-music.ts` (temas)
y `src/games/growcore-sfx.ts` (efectos).

| Momento | Música |
| --- | --- |
| Entrada | Pantalla **TOCÁ PARA ENTRAR**: el navegador no deja sonar nada hasta el primer toque, así que ese toque despierta el audio y recién ahí entra el título, con sonido. Si el juego está muteado, se saltea. |
| Inicio y resultados | **Ambiente**: 60 BPM, sin percusión. Acordes que crecen despacio (2 compases cada uno), una melodía lenta de campanas y un destello cada 4 compases, todo con mucha reverb. Nunca se corta. |
| Partida | El **Ambiente** sigue de fondo al 35 %, reducido a un dron La–Mi que no choca con ningún acorde. Encima, **Empuje**: 126 BPM, con bombo, bajo, hi-hats, colchón y arpegio de campanas desde el primer segundo. Cada nivel suma capas y 2 BPM: palmas y bajo más movido con Citrino (fase 2), melodía en semicorcheas con el Escudo (fase 3), hi-hats rodando y un sub grave con el Super Escudo (fase 5), hi-hats abiertos y contramelodía de campanas con los Cristales falsos (fase 7+). |
| Al perder | El Empuje se corta en seco y el Ambiente se calla; suenan campanas que caen sobre un golpe grave (**stinger**). Con **0 puntos**, en vez del stinger, un "wah wah wah waaah" triste. A los ~2 s el Ambiente vuelve a subir con sus acordes. |

| Efecto | Sonido |
| --- | --- |
| Título | Cada letra que cae suena como una campana; juntas hacen una escala que sube. |
| Encendido del núcleo | Un silbido fino que sube mientras los haces se cierran, una campana aguda cuando se juntan en un punto y un tono grave que crece con el núcleo. |
| Atraer | Un coro lejano (acorde abierto La–Mi) que se abre, brilla y sube un poco mientras mantenés. |
| Captura | Campana (Celestina), dos campanas (Citrino), tres campanas y un destello (Rodonita). La nota sube con la carga. |
| Cobro | Cascada de campanas, más larga cuanto más alto el tramo, sobre un golpe grave suave, y una ráfaga de aire que sale con la onda (más larga y llena cuanto más grande el núcleo). |
| Escudo / bloqueo | Arpegio de campanas que sube con un soplo de aire / "ting" de vidrio. |

## Por qué engancha

| Gancho | Cómo aparece en el juego |
| --- | --- |
| **Arriesgar o cobrar** | Cada cristal te acerca al próximo multiplicador y a la vez agranda el blanco. La codicia sube la dificultad, no el reloj. |
| **Pérdida visible** | Al morir: "Perdiste 7 cristales" y "Te faltaron 25 puntos para el 3º". El "casi" es lo que hace apretar reintentar. |
| **Habilidad legible** | La diferencia de masa hace que los toques cortos sean una técnica que se aprende y se nota. |
| **Casi-muertes** | "¡CERCA!" da puntos (directos, sin riesgo) cuando una mina roza el núcleo y se va. |
| **El sonido cuenta la tensión** | Cada captura suena más aguda que la anterior: cuanto más alto, más tenés en juego. Cobrar suena con un arpegio más largo cuanto mayor es el tramo. |
| **Reintento instantáneo** | Partidas de 20 a 90 s y un toque para volver a jugar, sin menús. |

## Controles

- **Mantener fuera del núcleo:** atraer.
- **Tocar el núcleo** (con algo guardado): cobrar. Ese toque no atrae aunque lo mantengas. Con el núcleo vacío, tocarlo atrae como cualquier otro lado, para que el jugador nuevo no se trabe.
- La primera vez que llegás a x2 aparece "¡TOCÁ EL NÚCLEO!" hasta que lo hacés estallar por primera vez. En los textos para el jugador, "cobrar" se dice **hacer estallar** el núcleo.

## Bucle

- **Núcleo (30 s):** mantener / soltar → cargar → cobrar o morir.
- **Partida:** puntaje → monedas (1 cada 5 puntos).
- **Meta (días, pendiente):** monedas → mejoras y skins → desafíos diarios → volver mañana.

**Puntaje y monedas:** cada partida empieza en 0 puntos y 0 monedas. Al terminar,
la partida (puntos, monedas, fecha) se guarda en una **tabla local** del
dispositivo, ordenada de mejor a peor (hasta 200 partidas). Para borrar la tabla de
todos los dispositivos una vez (por ejemplo, al cambiar cómo se puntúa), se sube
`BOARD_VERSION` en el código: cada dispositivo la vacía la próxima vez que carga.

**Pantalla final ("escalera"):** muestra cuántos cristales se perdieron ("Perdiste 7
cristales", si había cristales en el núcleo), el puntaje grande, las monedas ganadas y tres
filas: la partida de arriba, **esta partida** resaltada y la de abajo. Debajo, el
gancho de reintento:

- "Te faltaron 25 puntos para el 3º" (lo justo para superar al de arriba) + "Tu récord: 612".
- Si es el mejor: "¡NUEVO RÉCORD!" + "Superaste tu récord por 93".

**Récord en vivo:** durante la partida, en cuanto el puntaje pasa tu mejor partida
anterior aparece "RÉCORD ALCANZADO" arriba del puntaje (con un arpegio corto) y queda
hasta el final. En la primera partida no aparece: no hay nada que superar.
- La primera vez: "Tu primera partida".

Todo entra animado en ~1,3 s (velo, conteo rápido del puntaje con "pop" y chispas,
monedas, filas que se deslizan, mensaje o sello de récord con fanfarria); se puede
reintentar desde los 0,6 s aunque la animación no haya terminado. Tiempos en `RES`.

En el dispositivo también se guardan el mute y si el jugador ya hizo estallar el
núcleo alguna vez (para no repetirle el cartel de ayuda). Una tabla **global**
compartida entre jugadores necesitaría un servidor: queda para más adelante.

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
4. **En qué se gastan las monedas:** mejoras con tope (radio del campo +, gemas con imán propio, escudo de 1 golpe al inicio) y skins. Las mejoras hacen sentir progreso sin romper el récord global (la tabla de posiciones puede ir sin mejoras).

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

## Rendimiento

Regla para todo lo visual: **nada de `shadowBlur`** (el desenfoque del canvas es lo
más caro en celular). Los brillos se simulan con una forma translúcida detrás.

- **Minas**: se dibujan una sola vez como imagen (sprite) a la resolución real de la pantalla, en 16 pasos de giro (como tienen 8 pinchos iguales, alcanza con cubrir 1/8 de vuelta). En cada cuadro solo se copia la imagen que corresponde. Medido: 4,6 veces más rápido que la mina anterior con desenfoque (22,7 ms contra 103,9 ms por cada 1.000 minas, en PC).
- **Estrellas**: posiciones fijas generadas una vez; cada cuadro solo cambia su transparencia.
- **Pendiente**: las gemas, el núcleo y los escudos todavía usan `shadowBlur` para su brillo. Pasarlos al mismo esquema de sprites (o a halos translúcidos) es la próxima optimización.

## Valores de ajuste

Todo está arriba de [`src/games/growcore.ts`](../src/games/growcore.ts). Los más
importantes para el feel:

- `mass` de cada gema vs la mina en `KINDS`: la brecha de masa *es* el juego.
- `TIERS`: los cortes y multiplicadores del cobro. Es el número más importante del juego.
- `PHASES`: cuándo entra cada cosa, la mezcla y el ritmo de aparición (la curva de dificultad).
- `coreGrowth`, `coreMax` en `T`: cuánto castiga crecer.
- `fieldGrowth`, `pullGrowth` en `T`: cuánto premia crecer.
- `pullForce`, `pullDecay` en `T`: qué tan "pegajoso" se siente el imán.

**A vigilar en el test:** un jugador simulado muy prudente (solo atrae sin minas
cerca) sobrevive indefinidamente pero carga muy lento en las fases 4 y 5. Si un
humano lo siente estancado, bajar las minas de esas fases en `PHASES`, o hacer que
el tiempo también apriete (por ejemplo, minas que apuntan más cerca del núcleo).

## Próximos pasos del prototipo

- [x] Sonido: zumbido del campo que sube de tono mientras mantenés; "tink" por captura, cada vez más agudo con la carga (se aplana cerca de 2 kHz para que se oiga en el celular).
- [x] Música: ver la sección *Música*.
- [ ] Vibración (`navigator.vibrate`) en casi-muertes y en la muerte.
- [ ] Prototipo de la segunda oportunidad (sin SDK de anuncios, solo el flujo).
- [ ] Probar variantes: minas que *repelen* al soltar, gemas que solo valen si llegan seguidas.
- [x] **Cristales falsos ("gema maldita")**: hechos, ver la sección *Cristales falsos*. Idea original: un cristal facetado como las gemas buenas pero violeta oscuro con filos rojos y aristas dentadas. Se parece lo suficiente a una gema como para tentar, y castiga al que atrae sin mirar. Boceto de la forma en la lámina de opciones de mina (opción 6).
