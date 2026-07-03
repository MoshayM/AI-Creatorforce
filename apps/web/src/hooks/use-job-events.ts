'use client';
import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, type JobUpdateEvent, type JobCompleteEvent, type JobFailedEvent, type JobLogEvent } from '@/lib/ws';

export function useJobEvents(jobId: string | null) {
  const qc = useQueryClient();

  const invalidate = useCallback((id: string) => {
    void qc.invalidateQueries({ queryKey: ['job', id] });
    void qc.invalidateQueries({ queryKey: ['jobs'] });
  }, [qc]);

  useEffect(() => {
    if (!jobId) return;

    const socket = getSocket();

    socket.emit('subscribe:job', { jobId });

    const onUpdate = (e: JobUpdateEvent) => {
      if (e.jobId === jobId) invalidate(jobId);
    };
    const onComplete = (e: JobCompleteEvent) => {
      if (e.jobId === jobId) invalidate(jobId);
    };
    const onFailed = (e: JobFailedEvent) => {
      if (e.jobId === jobId) invalidate(jobId);
    };

    socket.on('job:update', onUpdate);
    socket.on('job:complete', onComplete);
    socket.on('job:failed', onFailed);

    return () => {
      socket.off('job:update', onUpdate);
      socket.off('job:complete', onComplete);
      socket.off('job:failed', onFailed);
    };
  }, [jobId, invalidate]);
}

export function useProjectJobEvents(
  projectId: string | null,
  onEvent?: (event: Record<string, unknown>) => void,
  onLog?: (event: JobLogEvent) => void,
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const socket = getSocket();

    // Join the project room so the backend can target this socket directly
    socket.emit('subscribe:project', { projectId });

    const onStatusEvent = (e: Record<string, unknown>) => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      void qc.invalidateQueries({ queryKey: ['jobs', 'project', projectId] });
      onEvent?.(e);
    };

    const onLogEvent = (e: JobLogEvent) => {
      onLog?.(e);
    };

    socket.on('job:update', onStatusEvent);
    socket.on('job:complete', onStatusEvent);
    socket.on('job:failed', onStatusEvent);
    socket.on('job:log', onLogEvent);

    return () => {
      socket.off('job:update', onStatusEvent);
      socket.off('job:complete', onStatusEvent);
      socket.off('job:failed', onStatusEvent);
      socket.off('job:log', onLogEvent);
    };
  }, [projectId, qc, onEvent, onLog]);
}
