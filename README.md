# CS2STATS

Partidos de Counter-Strike 2 en vivo, calendario y una predicción simple basada en la forma reciente de cada equipo. Los datos vienen de la API de [PandaScore](https://pandascore.co).

## Qué muestra

- **Partidos:** en vivo, próximos y finalizados, con formato (BO1/BO3/BO5), marcador y probabilidad estimada.
- **Calendario:** próximos partidos agrupados por día, en la zona horaria de quien visita.
- **Equipos en forma:** % de victorias en los últimos 10 partidos, calculado sobre los ~200 resultados más recientes.
- **Detalle de partido:** forma de cada equipo, cruces recientes y enlace a la transmisión.

### Cómo se calcula la predicción

Para cada equipo se toma su tasa de victorias en los últimos 10 partidos, suavizada con Laplace: `s = (victorias + 1) / (partidos + 2)`. La probabilidad del equipo A es `sA / (sA + sB)`. Si alguno de los dos tiene menos de 3 partidos en los datos, no se predice. Es un modelo deliberadamente simple y explicable.

## Stack

- HTML, CSS y JavaScript con módulos ES, sin frameworks ni paso de build.
- Una función serverless de Vercel (`api/ps.js`) que hace de proxy a PandaScore. Guarda el token del lado del servidor, solo acepta rutas y parámetros de una lista permitida y cachea en el CDN.

```
index.html        estructura de la página
css/styles.css    estilos (mobile-first a partir de 900px y 600px)
js/games.js       configuración por juego
js/api.js         cliente del proxy con caché en localStorage
js/model.js       normalización de partidos, forma y predicción
js/ui.js          formato y componentes HTML
js/app.js         estado, vistas, ruteo por hash y eventos
api/ps.js         proxy serverless a PandaScore
```

## Correrlo localmente

1. Creá un token gratuito en <https://app.pandascore.co>.
2. Copiá `.env.example` a `.env` y completá `PANDASCORE_TOKEN`.
3. Con Node 18 o superior:

```bash
npx vercel dev
```

## Deploy

En Vercel, agregá la variable de entorno `PANDASCORE_TOKEN` en *Settings → Environment Variables* y volvé a desplegar.
