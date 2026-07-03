import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
// @reason: socket.io types are provided by @nestjs/platform-socket.io at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Server = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Socket = any;

@WebSocketGateway({
  cors: { origin: process.env['WEB_URL'] ?? 'http://localhost:3007', credentials: true },
  namespace: '/events',
})
export class EventsGateway {
  @WebSocketServer()
  server!: Server;

  emitJobUpdate(jobId: string, data: Record<string, unknown>, projectId?: string) {
    const payload = { jobId, ...data };
    this.server.to(`job:${jobId}`).emit('job:update', payload);
    if (projectId) this.server.to(`project:${projectId}`).emit('job:update', payload);
  }

  emitJobComplete(jobId: string, result: unknown, projectId?: string) {
    const payload = { jobId, result };
    this.server.to(`job:${jobId}`).emit('job:complete', payload);
    if (projectId) this.server.to(`project:${projectId}`).emit('job:complete', payload);
  }

  emitJobFailed(jobId: string, error: string, projectId?: string) {
    const payload = { jobId, error };
    this.server.to(`job:${jobId}`).emit('job:failed', payload);
    if (projectId) this.server.to(`project:${projectId}`).emit('job:failed', payload);
  }

  emitJobLog(jobId: string, projectId: string, message: string, detail?: string) {
    const payload = { jobId, projectId, message, detail };
    this.server.to(`job:${jobId}`).emit('job:log', payload);
    this.server.to(`project:${projectId}`).emit('job:log', payload);
  }

  @SubscribeMessage('subscribe:job')
  handleSubscribeJob(
    @MessageBody() data: { jobId: string },
    @ConnectedSocket() client: Socket,
  ) {
    void client.join(`job:${data.jobId}`);
    return { event: 'subscribed', data: { jobId: data.jobId } };
  }

  @SubscribeMessage('subscribe:project')
  handleSubscribeProject(
    @MessageBody() data: { projectId: string },
    @ConnectedSocket() client: Socket,
  ) {
    void client.join(`project:${data.projectId}`);
    return { event: 'subscribed', data: { projectId: data.projectId } };
  }
}
