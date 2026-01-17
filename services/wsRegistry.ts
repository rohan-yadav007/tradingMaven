
// services/wsRegistry.ts
import { WebSocketManager } from './webSocketManager';

/**
 * Centrally manages WebSocketManager instances.
 * This ensures the entire application uses only 2 WebSocket connections (1 Spot, 1 Futures),
 * avoiding the browser limit of 6 concurrent connections to the same host.
 */
export const spotWsManager = new WebSocketManager(() => '/proxy-spot-ws');
export const futuresWsManager = new WebSocketManager(() => '/proxy-futures-ws');
