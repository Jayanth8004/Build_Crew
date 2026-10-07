import { io } from 'socket.io-client';
import { getToken } from '../api/client';

let socketInstance = null;
let currentToken = null;

const getSocketUrl = () => {
  if (import.meta.env.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL;
  }
  const apiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL;
  if (apiUrl) {
    return apiUrl.replace(/\/api\/?$/, '');
  }
  return import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin;
};

/**
 * Returns an authenticated Socket.IO singleton instance
 */
export function getSocket() {
  const token = getToken();

  // If token has changed or socket disconnected, re-initialize
  if (socketInstance && currentToken !== token) {
    socketInstance.disconnect();
    socketInstance = null;
  }

  if (!socketInstance) {
    currentToken = token;
    socketInstance = io(getSocketUrl(), {
      auth: { token },
      autoConnect: true,
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 10000,
      reconnectionDelay: 1000,
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[Socket.IO] Connection warning:', err.message);
    });
  } else if (!socketInstance.connected) {
    socketInstance.connect();
  }

  return socketInstance;
}

/**
 * Disconnects socket instance (e.g. on logout)
 */
export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    currentToken = null;
  }
}
