# Cuestionario – Ajedrez Distribuido con ZeroC Ice

**Estudiante:** Santiago Samboni – A00411900

## 1. Conexiones bidireccionales (BiDir) vs. callbacks tradicionales

En un callback normal, el cliente abre su propio `ObjectAdapter` con una IP y un puerto, y el servidor se conecta de vuelta a esa dirección para avisarle de los cambios. Esto funciona bien en el cliente JavaFX, pero en el navegador no es posible, porque por seguridad una página web no puede abrir puertos para escuchar conexiones.

La solución es aprovechar la conexión que el navegador ya tiene abierta con el servidor. Por eso el cliente web crea un adaptador sin endpoints (`createObjectAdapter("")`) y lo asocia a esa misma conexión con `servicePrx.ice_getConnection().setAdapter(adapter)`. Así, si el servidor envía una petición por ese WebSocket, Ice sabe que debe entregársela al observador que vive en el navegador.

Del lado del servidor, el proxy del observador llega sin dirección, así que no habría forma de contactarlo. Lo que hace `observer.ice_fixed(current.con)` es "amarrar" ese proxy a la conexión por la que llegó la petición. De esta manera, cuando el servidor llama a `onGameStateChanged` u `onGameFinished`, la llamada regresa por el mismo WebSocket, sin abrir conexiones nuevas y sin necesidad de *polling*.

## 2. TCP vs. WebSockets en ZeroC Ice

El servidor tiene un solo `ObjectAdapter` configurado con dos endpoints al mismo tiempo: `default -p 10000` (TCP) y `ws -h 0.0.0.0 -p 10002` (WebSocket). En ese adaptador se registra un único servant, `ChessServiceImpl`.

Esto funciona porque, para Ice, el transporte es solo el "camino" por donde viajan los mensajes. Sin importar si la petición entra por TCP desde JavaFX o por WebSocket desde el navegador, Ice la decodifica igual y se la entrega al mismo servant. Por eso la lógica del juego se escribe una sola vez y ambos clientes juegan en la misma partida sin problema.

## 3. Empaquetado del contrato con `slice2js`

El archivo `ChessService.js` que genera `slice2js` está envuelto en una función que detecta si se está ejecutando en Node o en el navegador. En el navegador, toma el runtime de Ice desde `window.Ice` y, al terminar, deja disponible `window.ChessApp`, que contiene todo lo definido en el contrato: enums, structs como `Position`, los proxies (`ChessServicePrx`, `ChessObserverPrx`) y la clase base `ChessObserver`.

Por eso es obligatorio cargar primero `Ice.min.js`. Todo lo que define el contrato se construye sobre las clases base de Ice (para serializar datos, crear proxies, etc.). Si `window.Ice` todavía no existe cuando se carga `ChessService.js`, el contrato no tiene sobre qué construirse y `ChessApp` nunca se crea.

## 4. Validación autoritativa

Las sugerencias que muestra el navegador (`chessRulesHelper.js`) son solo una ayuda visual para que el jugador vea rápido a dónde puede mover. Son cálculos sencillos: no revisan si el movimiento deja al propio rey en jaque, ni validan correctamente los turnos.

Además, cualquier persona puede modificar el código del cliente desde la consola del navegador o enviar peticiones manualmente. Si el servidor confiara en lo que le manda el cliente, sería muy fácil hacer trampa. Por eso `GameRoom.makeMove` vuelve a validar cada jugada con `ChessRules`: el servidor es el único que decide qué es legal. Así todos los clientes (JavaFX, web y espectadores) ven siempre el mismo estado de la partida, sin importar qué haga cada cliente por su cuenta.
