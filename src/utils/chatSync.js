// Merge overlapping HTTP snapshots and socket events without losing live messages.
export function mergeMessages(previous, incoming) {
  const byId = new Map(previous.map(message => [String(message._id), message]));
  for (const message of incoming) {
    if (message.clientMessageId && !message.pending) {
      const sender = value => String(value?._id || value?.id || value);
      for (const [id, existing] of byId) {
        if (existing.pending && existing.clientMessageId === message.clientMessageId &&
            sender(existing.senderId) === sender(message.senderId)) byId.delete(id);
      }
    }
    byId.set(String(message._id), message);
  }
  return [...byId.values()].sort((a, b) =>
    new Date(a.createdAt) - new Date(b.createdAt) || String(a._id).localeCompare(String(b._id))
  ).slice(-500);
}

// Socket push where available, automatic HTTP recovery on serverless hosting.
// Only one history request can be in flight. Rejoining precedes reconnect recovery.
export function subscribeChat({ socket, kind, id, load, onData, onError }) {
  let stopped = false;
  let busy = false;
  let timer;
  let after;
  const sync = async () => {
    if (stopped || busy || document.hidden) return;
    busy = true;
    try {
      const data = await load(after);
      if (!stopped) {
        onData(data);
        const last = data.messages?.at(-1);
        // Replay a small overlap to include writes that finish out of order.
        if (last) after = new Date(new Date(last.createdAt).getTime() - 30000).toISOString();
      }
    } catch (error) {
      if (!stopped) onError?.(error);
    } finally {
      busy = false;
      if (!stopped) {
        clearTimeout(timer);
        timer = setTimeout(sync, socket.connected ? 15000 : 2000);
      }
    }
  };
  const join = () => {
    socket.emit(`join_${kind}`, { [`${kind}Id`]: id }, response => {
      if (!stopped && response?.error) onError?.(new Error(response.error));
      else sync();
    });
  };
  const wake = () => { clearTimeout(timer); sync(); };
  socket.on('connect', join);
  socket.on('disconnect', wake);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  if (socket.connected) join();
  sync();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket.off('connect', join);
    socket.off('disconnect', wake);
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('online', wake);
    if (socket.connected) socket.emit(`leave_${kind}`, { [`${kind}Id`]: id });
  };
}
