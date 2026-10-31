# VG-Mini

Laboratorio de minijuegos web rápidos (TypeScript + Vite, `<canvas>` 2D) para
probar mecánicas antes de invertir en producción.

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # chequeo de tipos + build a dist/
npm run preview  # sirve el build
```

Cada minijuego se elige por hash en la URL, p. ej. `http://localhost:5173/#iman`.

## Juegos

| Juego | Idea | Diseño |
| --- | --- | --- |
| `iman` | Mantené presionado para atraer cristales sin tragarte una mina. | [docs/iman.md](docs/iman.md) |

## Estructura

- `src/main.ts` — escala el canvas a la ventana, elige el juego y arranca el loop.
- `src/engine/` — loop de paso fijo, input (teclado, mouse, touch) y guardado local.
- `src/games/MiniGame.ts` — interfaz común y resolución lógica (360x640, vertical).
- `src/games/<juego>.ts` — un archivo por minijuego; sumarlo al registro en `main.ts`.
