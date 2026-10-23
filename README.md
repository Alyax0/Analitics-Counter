# CS2STATS

Partidos de **Counter-Strike 2** y **Valorant** en vivo, calendario, planteles, noticias y una predicción simple basada en la forma reciente de cada equipo. Los datos vienen de la API de [PandaScore](https://pandascore.co).

## Qué muestra

Cada juego tiene sus propias secciones, con rutas `#/cs2/...` y `#/valorant/...` y un selector arriba para cambiar de juego.

- **Partidos:** en vivo, próximos y finalizados, con formato (BO1/BO3/BO5), marcador y probabilidad estimada.
- **Calendario:** próximos partidos agrupados por día, en la zona horaria de quien visita.
- **Equipos en forma:** % de victorias en los últimos 10 partidos, calculado sobre los resultados recientes más el historial de los equipos que juegan pronto.
- **Modo demo:** si la API no responde, se cargan datos reales capturados en `data/demo.json` (CS2) o `data/demo-valorant.json`, con un aviso. Con `?demo` en la URL se fuerza ese modo.
- **Detalle de partido:** forma de cada equipo, cruces recientes, planteles y enlace a la transmisión.
- **Ficha de equipo:** plantel con nacionalidad y edad, próximos partidos y últimos 10 resultados.
- **Noticias:** en CS2, titulares de HLTV (RSS) y notas de parche oficiales de Valve (API de noticias de Steam); en Valorant, titulares de VLR.gg (RSS). Todas con enlace a la fuente original.

### Cómo se calcula la predicción

Para cada equipo se toma su tasa de victorias en los últimos 10 partidos, suavizada con Laplace: `s = (victorias + 1) / (partidos + 2)`. La probabilidad del equipo A es `sA / (sA + sB)`. Si alguno de los dos tiene menos de 3 partidos en los datos, no se predice. Es un modelo deliberadamente simple y explicable.

### Historial de predicciones y % de aciertos

Un workflow de GitHub Actions (`.github/workflows/predictions.yml`) corre cada 30 minutos:

1. Guarda la predicción de cada partido que empieza en las próximas 6 horas, con la hora en que se hizo. No se modifica nunca.
2. Cuando el partido termina, anota el resultado. Si la predicción quedó guardada después del inicio real, se anula.
3. Commitea todo en la rama [`data`](https://github.com/Alyax0/Analitics-Counter/tree/data): `predictions/<juego>/<AAAA-MM>.json` (un registro por línea) y `predictions/summary.json`, que es lo que lee la sección **Aciertos**.

El historial de commits de esa rama es la prueba pública de que cada predicción se hizo antes del partido. No cuentan los cancelados, los ganados por W.O. ni los empates. Además del % de aciertos se muestra el [Brier score](https://es.wikipedia.org/wiki/Puntuaci%C3%B3n_de_Brier) (0 es perfecto; tirar una moneda da 0.25).

Para que funcione, el repo necesita el secreto `PANDASCORE_TOKEN` en *Settings → Secrets and variables → Actions*.

## Stack

- HTML, CSS y JavaScript con módulos ES, sin frameworks ni paso de build.
- Una función serverless de Vercel (`api/ps.js`) que hace de proxy a PandaScore. Guarda el token del lado del servidor, solo acepta rutas y parámetros de una lista permitida y cachea en el CDN.

```
index.html        estructura de la página
css/styles.css    estilos (mobile-first a partir de 900px y 600px)
js/games.js       configuración por juego (CS2 y Valorant)
js/api.js         cliente del proxy con caché en localStorage
js/model.js       normalización de partidos, forma y predicción
js/ui.js          formato y componentes HTML
js/app.js         estado, vistas, ruteo por hash y eventos
api/ps.js         proxy serverless a PandaScore
api/news.js       noticias por juego (HLTV, Steam, VLR.gg), con caché de 15 min
scripts/          registro de predicciones (lo corre GitHub Actions)
```

> Las estadísticas individuales de jugadores (K/D, ADR, rating) no están en el plan gratuito de PandaScore, así que la página no las muestra.

## Correrlo localmente

1. Creá un token gratuito en <https://app.pandascore.co>.
2. Copiá `.env.example` a `.env` y completá `PANDASCORE_TOKEN`.
3. Con Node 18 o superior:

```bash
npx vercel dev
```

## Deploy

En Vercel, agregá la variable de entorno `PANDASCORE_TOKEN` en *Settings → Environment Variables* y volvé a desplegar.
