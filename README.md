# Chamuyo (Mock)

Frontend estático pensado para correr en **GitHub Pages**. El backend real se conectará reemplazando **solo** el conector (`connector.js`).

## Cómo probar en GitHub Pages

1. Publicá el repo en GitHub Pages (Settings → Pages → Deploy from branch).
2. Accedé a la URL publicada (HTTPS).
3. La app carga directo desde `index.html` y utiliza el conector mock por defecto.

## Debug visual

Agregá `?debug=1` al final de la URL:

```
https://<usuario>.github.io/<repo>/?debug=1
```

Vas a ver un panel en pantalla que muestra:
- Estado de carga del frontend.
- Errores JS (window.onerror / unhandledrejection).
- Métodos disponibles del conector.
- Clicks de botones principales.

## Qué estaba roto y por qué

1. **Import JSON en módulos**: `connector.mock.js` importaba `mock.json` con `assert { type: "json" }`, lo que rompe en algunos navegadores y en varios entornos móviles de GitHub Pages (módulos JSON no soportados). Ahora el mock se carga vía `fetch`.
2. **Service Worker cacheando HTML viejo**: el SW cacheaba `index.html` y no tenía una estrategia de actualización clara, lo que podía dejar la UI vieja y desincronizada. Ahora usa un cache versionado y estrategia *network-first* para HTML.

## Arquitectura del conector

El frontend usa **solo** estos métodos del conector (`connector.js`):
- `createRoom`
- `joinRoom`
- `getRoomState`
- `startGame`
- `getMyHand`
- `markSuccess`
- `markVoided`
- `getNewCard`
- `listDecks`

El mock está activo por defecto. Para conectar un backend real, se reemplaza el export en `connector.js`.
