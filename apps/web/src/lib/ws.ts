import { io, type Socket } from 'socket.io-client';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:4007';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cf_token') : null;
    socket = io(`${WS_URL}/events`, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export interface JobUpdateEvent {
  jobId: string;
  status?: string;
  step?: string;
  [key: string]: unknown;
}

export interface JobCompleteEvent {
  jobId: string;
  result: unknown;
  elapsedMs: number;
}

export interface JobFailedEvent {
  jobId: string;
  error: string;
}

export interface JobLogEvent {
  jobId: string;
  projectId: string;
  message: string;
  detail?: string;
}
