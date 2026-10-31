# VG-Mini

Mini juego web en TypeScript + Vite, renderizado en un `<canvas>` 2D.

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # chequeo de tipos + build a dist/
npm run preview  # sirve el build
```

## Estructura

- `src/main.ts` — arranca el canvas y el loop.
- `src/game/loop.ts` — loop de paso fijo (60 updates/s, render interpolado).
- `src/game/input.ts` — estado del teclado.
- `src/game/Game.ts` — lógica y dibujo del juego (resolución lógica 320x180).
