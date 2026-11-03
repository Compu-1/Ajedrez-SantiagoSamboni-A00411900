/**
 * Gestor de actualizaciones en tiempo real para el cliente Web mediante
 * Conexiones Bidireccionales (BiDir) sobre WebSockets en ZeroC Ice.
 * Implementa el servant ChessObserver en el navegador sin usar polling.
 */
export class ChessRealtimeObserver {
    constructor(Ice, ChessApp) {
        this.Ice = Ice;
        this.ChessApp = ChessApp;
        this.adapter = null;
        this.identity = null;
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;
    }

    /**
     * Crea el servant de ChessObserver, configura el ObjectAdapter bidireccional
     * sobre la conexión WebSocket activa y registra el observador en la sala.
     */
    async subscribe(communicator, servicePrx, roomCode, nickname, { onStateChanged, onGameFinished } = {}) {
        // 3.1 Limpiar suscripción previa y guardar callbacks
        await this.cleanupAdapter();
        this.onStateChangedCallback = onStateChanged || null;
        this.onGameFinishedCallback = onGameFinished || null;

        // 3.2 Servant: el servidor invoca estos métodos cuando cambia la partida
        const self = this;
        class WebChessObserverServant extends this.ChessApp.ChessObserver {
            onGameStateChanged(newState, _current) {
                if (self.onStateChangedCallback) {
                    self.onStateChangedCallback(newState);
                }
            }

            onGameFinished(finalState, winnerNickname, pointsDelta, _current) {
                if (self.onGameFinishedCallback) {
                    self.onGameFinishedCallback(finalState, winnerNickname, pointsDelta);
                }
            }
        }

        // 3.3 Adaptador SIN endpoints (el navegador no puede escuchar puertos)
        this.adapter = await communicator.createObjectAdapter("");
        this.identity = new this.Ice.Identity(this.Ice.generateUUID(), "ChessObserver");
        this.adapter.add(new WebChessObserverServant(), this.identity);
        await this.adapter.activate();

        // 3.4 Reusar la misma conexión WebSocket del proxy para recibir los callbacks
        const connection = await servicePrx.ice_getConnection();
        connection.setAdapter(this.adapter);

        const observerPrx = this.ChessApp.ChessObserverPrx.uncheckedCast(
            this.adapter.createProxy(this.identity)
        );
        await servicePrx.registerObserver(roomCode, nickname, observerPrx);
    }

    /**
     * Desvincula el observador de la sala en el servidor y limpia el adaptador local.
     */
    async unsubscribe(servicePrx, roomCode, nickname) {
        this.onStateChangedCallback = null;
        this.onGameFinishedCallback = null;

        if (servicePrx && roomCode) {
            try {
                await servicePrx.unregisterObserver(roomCode, nickname);
            } catch (err) {
                console.warn("Error desregistrando el observador:", err);
            }
        }
        await this.cleanupAdapter();
    }

    async cleanupAdapter() {
        if (!this.adapter) {
            return;
        }
        try {
            if (this.identity) {
                this.adapter.remove(this.identity);
            }
            await this.adapter.destroy();
        } catch (err) {
            console.warn("Error limpiando el ObjectAdapter local:", err);
        } finally {
            this.adapter = null;
            this.identity = null;
        }
    }
}
