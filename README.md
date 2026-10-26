# CS2STATS

Partidos de **Counter-Strike 2**, **Valorant** y **Overwatch** en vivo, calendario, planteles, noticias y una predicción simple basada en la forma reciente de cada equipo. Los datos vienen de la API de [PandaScore](https://pandascore.co).

## Qué muestra

Cada juego tiene sus propias secciones, con rutas `#/cs2/...`, `#/valorant/...` y `#/overwatch/...`, y un selector arriba para cambiar de juego.

- **Partidos:** en vivo, próximos y finalizados, con formato (BO1/BO3/BO5, o FT3/FT4 en Overwatch), marcador y probabilidad estimada.
- **Calendario:** próximos partidos agrupados por día, en la zona horaria de quien visita.
- **Equipos en forma:** % de victorias en los últimos 10 partidos, calculado sobre los resultados recientes más el historial de los equipos que juegan pronto.
- **Modo demo:** si la API no responde, se cargan datos reales capturados en `data/demo.json` (CS2), `data/demo-valorant.json` o `data/demo-overwatch.json`, con un aviso. Con `?demo` en la URL se fuerza ese modo.
- **Detalle de partido:** forma de cada equipo, cruces recientes, planteles y enlace a la transmisión.
- **Ficha de equipo:** plantel con nacionalidad y edad, próximos partidos y últimos 10 resultados.
- **Noticias:** una nota destacada grande y una grilla de dos columnas, con la imagen de portada de la fuente (o un degradado si no trae) y la etiqueta NUEVO en las de menos de 48 h. En CS2, titulares de HLTV (RSS) y notas de parche oficiales de Valve (API de noticias de Steam); en Valorant, titulares de VLR.gg y Dexerto (RSS); en Overwatch, anuncios oficiales de Blizzard en Steam y titulares de Dexerto (RSS). Todas con enlace a la fuente original.

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
js/games.js       configuración por juego (CS2, Valorant y Overwatch)
js/api.js         cliente del proxy con caché en localStorage
js/model.js       normalización de partidos, forma y predicción
js/ui.js          formato y componentes HTML
js/app.js         estado, vistas, ruteo por hash y eventos
js/home.js        home de cada juego
js/i18n.js        traducciones: t(clave), idioma guardado en el navegador
i18n/*.json       textos de la interfaz en español e inglés
api/ps.js         proxy serverless a PandaScore
api/news.js       noticias e imágenes por juego (HLTV, Steam, VLR.gg, Dexerto), con caché de 15 min
scripts/          registro de predicciones (lo corre GitHub Actions)
```

> Las estadísticas individuales de jugadores (K/D, ADR, rating) no están en el plan gratuito de PandaScore, así que la página no las muestra.

## Idiomas

Todos los textos de la interfaz están en `i18n/es.json` e `i18n/en.json`. El botón ES/EN de la barra cambia el idioma sin recargar y la elección se guarda en el navegador; en la primera visita se usa el idioma del navegador (español si no es ninguno de los dos). Las fechas y horas siguen el idioma elegido. Los titulares de noticias quedan en el idioma de su fuente.

Para agregar un texto: sumar la clave en los dos archivos y usar `t('seccion.clave')` en el código.

## Correrlo localmente

1. Creá un token gratuito en <https://app.pandascore.co>.
2. Copiá `.env.example` a `.env` y completá `PANDASCORE_TOKEN`.
3. Con Node 18 o superior:

```bash
npx vercel dev
```

## Deploy

En Vercel, agregá la variable de entorno `PANDASCORE_TOKEN` en *Settings → Environment Variables* y volvé a desplegar.
