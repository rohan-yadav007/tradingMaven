
// services/webSocketManager.ts

const INITIAL_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 60000;
let nextRequestId = 1;

export class WebSocketManager {
    private ws: WebSocket | null = null;
    private subscriptions = new Map<string, Function[]>();
    private getUrl: () => string;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private isConnected = false;
    private isConnecting = false;
    private retryCount = 0;
    private healthyConnectionTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(getUrl: () => string) {
        this.getUrl = getUrl;
    }

    private connect() {
        if (this.isConnecting) return;
        
        if (this.ws) {
            this.cleanupSocket();
        }

        this.isConnecting = true;
        const url = `${this.getUrl()}/stream`;
        
        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.error(`[WS Manager] Failed to create WebSocket instance for ${url}`, e);
            this.handleClose(1006, 'Creation Failed');
            return;
        }

        this.ws.onopen = () => {
            this.isConnected = true;
            this.isConnecting = false;
            console.log(`[WS Manager] Connected to ${url}`);
            
            const streamsToSubscribe = Array.from(this.subscriptions.keys());
            if (streamsToSubscribe.length > 0) {
                this.sendSubscriptionMessage('SUBSCRIBE', streamsToSubscribe);
            }

            if (this.healthyConnectionTimeout) clearTimeout(this.healthyConnectionTimeout);
            this.healthyConnectionTimeout = setTimeout(() => {
                this.retryCount = 0;
            }, 5000);

            // Start heartbeat
            if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = setInterval(() => {
                // Sending a ping ensures proxies don't close idle connections
                // Browser handles Binance pings automatically, but we send a frame to be safe
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ method: "LIST_SUBSCRIPTIONS", id: 999 }));
                }
            }, 30000);
        };

        this.ws.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch (error) {
                return;
            }

            if (message.stream && message.data) {
                const callbacks = this.subscriptions.get(message.stream);
                if (callbacks) {
                    callbacks.forEach(cb => {
                        try { cb(message.data); } catch (error) { console.error(`[WS Manager] Error in callback:`, error); }
                    });
                }
            }
        };

        this.ws.onerror = (error) => {
            console.error(`[WS Manager] WebSocket error:`, error);
        };

        this.ws.onclose = (event) => {
            this.handleClose(event.code, event.reason);
        };
    }

    private cleanupSocket() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onerror = null;
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    }

    private handleClose(code?: number, reason?: string) {
        if (this.healthyConnectionTimeout) clearTimeout(this.healthyConnectionTimeout);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        
        this.isConnected = false;
        this.isConnecting = false;
        this.cleanupSocket();

        const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(1.5, this.retryCount), MAX_RECONNECT_DELAY);
        console.log(`[WS Manager] Disconnected (Code: ${code}, Reason: ${reason || 'None'}). Reconnecting in ${delay}ms... (Attempt ${this.retryCount + 1})`);
        
        this.retryCount++;

        if (this.subscriptions.size > 0) {
            if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = setTimeout(() => this.connect(), delay);
        }
    }

    private sendSubscriptionMessage(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            if (!this.isConnected && !this.isConnecting && this.subscriptions.size > 0) {
                this.connect();
            }
            return;
        }
        try {
            this.ws.send(JSON.stringify({ method, params, id: nextRequestId++ }));
        } catch (e) {
            console.error("[WS Manager] Failed to send message", e);
        }
    }

    public subscribe(streamName: string, callback: Function) {
        let callbacks = this.subscriptions.get(streamName);
        if (!callbacks) {
            callbacks = [];
            this.subscriptions.set(streamName, callbacks);
            if (this.isConnected) {
                this.sendSubscriptionMessage('SUBSCRIBE', [streamName]);
            }
        }
        if (!callbacks.includes(callback)) {
            callbacks.push(callback);
        }
        
        if (!this.isConnected && !this.isConnecting) {
            this.connect();
        }
    }

    public unsubscribe(streamName: string, callback: Function) {
        const callbacks = this.subscriptions.get(streamName);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) callbacks.splice(index, 1);
            if (callbacks.length === 0) {
                this.subscriptions.delete(streamName);
                if (this.isConnected) {
                    this.sendSubscriptionMessage('UNSUBSCRIBE', [streamName]);
                }
            }
        }
    }

    public disconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.healthyConnectionTimeout) clearTimeout(this.healthyConnectionTimeout);
        this.cleanupSocket();
        this.subscriptions.clear();
        this.isConnected = false;
        this.isConnecting = false;
        this.retryCount = 0;
    }
}
