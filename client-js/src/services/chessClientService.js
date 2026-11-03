// Paso 1: el runtime de Ice debe cargarse ANTES que el contrato generado,
// porque ChessService.js usa window.Ice para registrar window.ChessApp.
import "../../lib/Ice.min.js";
import "./ChessService.js";
import { ChessRealtimeObserver } from "./chessRealtimeObserver.js";

/**
 * Servicio de comunicación RPC con ZeroC Ice sobre WebSockets.
 * Encapsula el ciclo de vida del Communicator, el proxy de ChessService
 * y la suscripción en tiempo real mediante ChessRealtimeObserver.
 */
export class ChessClientService {
    constructor() {
        this.Ice = window.Ice;
        this.ChessApp = window.ChessApp;

        this.communicator = null;
        this.service = null;
        this.realtimeObserver = null;
        this.isConnected = false;

        this.nickname = null;
        this.currentRoomCode = null;
        this.role = null;
        this.assignedColor = null;
    }

    validateRuntime() {
        if (!this.Ice) {
            throw new Error("No se encontró el runtime de ZeroC Ice (window.Ice). Revisa lib/Ice.min.js.");
        }
        if (!this.ChessApp) {
            throw new Error("No se encontró el contrato ChessApp. Genera src/services/ChessService.js con slice2js.");
        }
    }

    async connect(host, port, nickname) {
        this.validateRuntime();

        if (this.communicator) {
            try {
                await this.communicator.destroy();
            } catch (err) {
                console.warn("Error destruyendo el communicator anterior:", err);
            }
            this.communicator = null;
            this.service = null;
            this.isConnected = false;
        }

        const targetHost = (host && host.trim()) || "127.0.0.1";
        const targetPort = Number(port) || 10002;
        this.nickname = (nickname && nickname.trim()) || "Invitado";

        const initData = new this.Ice.InitializationData();
        initData.properties = this.Ice.createProperties();
        initData.properties.setProperty("Ice.MessageSizeMax", "2048");
        initData.properties.setProperty("Ice.ACM.Client.Timeout", "0");
        initData.properties.setProperty("Ice.ACM.Client.Heartbeat", "3");

        this.communicator = this.Ice.initialize(initData);

        const base = this.communicator.stringToProxy(`ChessService:ws -h ${targetHost} -p ${targetPort}`);
        this.service = await this.ChessApp.ChessServicePrx.checkedCast(base);
        if (!this.service) {
            throw new Error("El proxy remoto no implementa ChessApp::ChessService.");
        }

        this.realtimeObserver = new ChessRealtimeObserver(this.Ice, this.ChessApp);
        this.isConnected = true;
    }

    async getLobbyData() {
        this.ensureConnected();
        // Las dos invocaciones viajan en paralelo; esperamos a que ambas terminen.
        const [rooms, leaderboard] = await Promise.all([
            this.service.getActiveRooms(),
            this.service.getLeaderboard()
        ]);
        return { rooms, leaderboard };
    }

    async createRoom(nickname) {
        this.ensureConnected();
        if (nickname && nickname.trim()) {
            this.nickname = nickname.trim();
        }
        return await this.service.createRoom(this.nickname);
    }

    async joinRoom(roomCode, nickname) {
        this.ensureConnected();
        if (nickname && nickname.trim()) {
            this.nickname = nickname.trim();
        }
        const normalizedCode = roomCode.trim().toUpperCase();

        const result = await this.service.joinRoom(normalizedCode, this.nickname);
        this.currentRoomCode = normalizedCode;
        this.role = result.role;
        this.assignedColor = result.assignedColor;
        return result;
    }

    async subscribeToRoom(listeners = {}) {
        this.ensureConnected();
        await this.realtimeObserver.subscribe(
            this.communicator,
            this.service,
            this.currentRoomCode,
            this.nickname,
            listeners
        );
    }

    async makeMove(fromRow, fromCol, toRow, toCol) {
        this.ensureConnected();
        const fromPos = new this.ChessApp.Position(fromRow, fromCol);
        const toPos = new this.ChessApp.Position(toRow, toCol);
        return await this.service.makeMove(this.currentRoomCode, this.nickname, fromPos, toPos);
    }

    async resign() {
        this.ensureConnected();
        await this.service.resign(this.currentRoomCode, this.nickname);
    }

    async leaveRoom() {
        if (!this.isConnected || !this.currentRoomCode) {
            return;
        }
        const roomCode = this.currentRoomCode;

        if (this.realtimeObserver) {
            await this.realtimeObserver.unsubscribe(this.service, roomCode, this.nickname);
        }
        try {
            await this.service.leaveRoom(roomCode, this.nickname);
        } catch (err) {
            console.warn("Error abandonando la sala:", err);
        }

        this.currentRoomCode = null;
        this.role = null;
        this.assignedColor = null;
    }

    ensureConnected() {
        if (!this.isConnected || !this.service) {
            throw new Error("No hay conexión con el servidor Ice. Conéctate primero.");
        }
    }
}
