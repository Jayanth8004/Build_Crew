import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { chatApi } from '../api/chat';
import { mergeMessages, subscribeChat } from '../utils/chatSync';

export default function TeamChatModal({ team, currentUser, isOpen, onClose }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [teamDetails, setTeamDetails] = useState(null);
  const [showMembers, setShowMembers] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const teamId = team?._id || team?.id;
  const currentUserId = String(currentUser?._id || currentUser?.id || '');

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Fetch chat history from MongoDB and setup Socket.IO room subscription
  useEffect(() => {
    if (!isOpen || !teamId) return;

    let isMounted = true;
    const socket = getSocket();

    // Clear the previous room before subscribing to this conversation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages([]);
    setTeamDetails(null);
    setIsLoading(true);
    setLoadError(null);
    setSendError(null);
    const unsubscribe = subscribeChat({
      socket, kind: 'team', id: teamId,
      load: after => chatApi.getTeamMessages(teamId, after),
      onData: data => {
        setMessages(previous => mergeMessages(previous, data.messages || []));
        setTeamDetails({ teamName: data.teamName, members: data.members || [] });
        setIsLoading(false);
        setLoadError(null);
      },
      onError: error => { setLoadError(error.message); setIsLoading(false); },
    });

    // 3. Listen for real-time incoming messages broadcasted via Socket.IO
    const handleNewMessage = (newMessage) => {
      if (!isMounted) return;
      if (String(newMessage.teamId) === String(teamId)) {
        setMessages((prev) => {
          // Prevent duplicate messages if already present
          if (prev.some((m) => String(m._id) === String(newMessage._id))) {
            return prev;
          }
          return mergeMessages(prev, [newMessage]);
        });
        setTimeout(() => {
          if (isMounted) scrollToBottom(true);
        }, 50);
      }
    };

    socket.on('new_message', handleNewMessage);

    // Focus input field when chat opens
    setTimeout(() => {
      inputRef.current?.focus();
    }, 200);

    return () => {
      isMounted = false;
      unsubscribe();
      socket.off('new_message', handleNewMessage);
    };
  }, [isOpen, teamId, scrollToBottom]);

  // Scroll to bottom when message list changes
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(true);
    }
  }, [messages.length, scrollToBottom]);

  // Send message handler
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();

    if (!trimmed || isSending) return;

    if (trimmed.length > 1000) {
      setSendError('Message cannot exceed 1000 characters.');
      return;
    }

    setIsSending(true);
    setSendError(null);
    setInputText('');
    const clientMessageId = `pending-${crypto.randomUUID()}`;
    setMessages(previous => mergeMessages(previous, [{
      _id: clientMessageId, clientMessageId, senderId: currentUser,
      text: trimmed, createdAt: new Date().toISOString(), pending: true,
    }]));
    try {
      const res = await chatApi.sendMessage(teamId, trimmed, clientMessageId);
      setMessages(previous => mergeMessages(previous, [res.message]));
    } catch {
      setMessages(previous => previous.filter(message => message._id !== clientMessageId));
      setInputText(previous => previous || trimmed);
      setSendError('Message could not be confirmed. Check the chat before retrying.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!isOpen || !team) return null;

  const displayTitle = teamDetails?.teamName || team.teamName || team.title || 'Team Chat';
  const membersList = teamDetails?.members || team.members || [];
  const memberCount = membersList.length > 0 ? membersList.length : (team.filledCount || 1);

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-primary-container/40 backdrop-blur-sm animate-modal">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-2xl h-[90vh] max-h-[700px] flex flex-col bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container-high overflow-hidden z-10">
        {/* Top Header */}
        <div className="px-space-md py-3 bg-surface-container-low border-b border-surface-container-high/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-space-sm min-w-0">
            <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-xl">forum</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-headline-sm text-base font-bold text-on-surface truncate">
                  {displayTitle}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Text Chat
                </span>
              </div>
              <p className="font-body-sm text-xs text-on-surface-variant truncate">
                Team Chat • {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowMembers(!showMembers)}
              className={`p-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1 text-xs font-semibold ${
                showMembers
                  ? 'bg-secondary text-on-secondary'
                  : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
              }`}
              title="Toggle Team Members"
            >
              <span className="material-symbols-outlined text-lg">group</span>
              <span className="hidden sm:inline">Members</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
              aria-label="Close Chat"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>

        {/* Expandable Team Members Panel */}
        {showMembers && (
          <div className="bg-surface-container-low/70 border-b border-surface-container-high/60 p-space-md shrink-0 animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <span className="font-label-sm text-xs uppercase tracking-wider text-outline font-bold">
                Team Roster ({membersList.length})
              </span>
              <span className="text-[11px] text-outline">All team members can chat here</span>
            </div>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
              {membersList.length === 0 ? (
                <span className="text-xs text-on-surface-variant">No member profiles loaded.</span>
              ) : (
                membersList.map((m, idx) => {
                  const mId = m._id || m.id || idx;
                  const mName = m.name || 'Member';
                  const mAvatar = m.avatar || m.profileImage;
                  const isCurrent = String(mId) === currentUserId;

                  return (
                    <div
                      key={mId}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-surface-container-high/60 text-xs text-on-surface"
                    >
                      <div className="relative shrink-0">
                        {mAvatar ? (
                          <img
                            src={mAvatar}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : null}
                        <div
                          style={{ display: mAvatar ? 'none' : 'flex' }}
                          className="w-5 h-5 rounded-full bg-secondary/15 text-secondary font-bold text-[10px] items-center justify-center shrink-0"
                        >
                          {mName.charAt(0).toUpperCase()}
                        </div>
                      </div>
                      <span className="font-medium truncate max-w-[120px]">
                        {mName} {isCurrent ? '(You)' : ''}
                      </span>
                      {m.roleTitle && (
                        <span className="text-[10px] text-outline truncate max-w-[80px]">
                          • {m.roleTitle}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Chat Messages Body */}
        <div className="flex-1 p-space-md overflow-y-auto space-y-3 bg-surface-container-lowest flex flex-col">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant space-y-2">
              <span className="material-symbols-outlined text-3xl animate-spin text-secondary">
                progress_activity
              </span>
              <p className="font-body-sm text-xs">Loading team chat history...</p>
            </div>
          ) : loadError ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-space-md space-y-2">
              <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl">lock</span>
              </div>
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">{loadError}</h3>
              <p className="font-body-sm text-xs text-on-surface-variant max-w-xs">
                Reconnecting automatically. Check your connection and team membership if this continues.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 py-1.5 px-4 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-space-lg text-on-surface-variant space-y-2 my-auto">
              <div className="w-14 h-14 rounded-2xl bg-surface-container-low flex items-center justify-center text-secondary mb-1">
                <span className="material-symbols-outlined text-3xl">chat</span>
              </div>
              <p className="font-headline-sm text-sm font-bold text-on-surface">No messages yet</p>
              <p className="font-body-sm text-xs max-w-sm text-on-surface-variant">
                Say hello to your squad! New messages appear automatically for all team members.
              </p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const senderObj = typeof msg.senderId === 'object' && msg.senderId !== null ? msg.senderId : {};
              const senderId = String(senderObj._id || senderObj.id || msg.senderId || '');
              const isMe = senderId === currentUserId;
              const senderName = isMe ? 'You' : (senderObj.name || 'Teammate');
              const senderAvatar = isMe
                ? (currentUser?.avatar || currentUser?.profileImage)
                : (senderObj.avatar || senderObj.profileImage || '');

              return (
                <div
                  key={msg._id || index}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] sm:max-w-[75%] ${
                    isMe ? 'self-end' : 'self-start'
                  }`}
                >
                  {/* Sender Header for Incoming Messages */}
                  {!isMe && (
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <div className="relative shrink-0">
                        {senderAvatar ? (
                          <img
                            src={senderAvatar}
                            alt=""
                            className="w-4 h-4 rounded-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : null}
                        <div
                          style={{ display: senderAvatar ? 'none' : 'flex' }}
                          className="w-4 h-4 rounded-full bg-secondary/15 text-secondary font-bold text-[9px] items-center justify-center shrink-0"
                        >
                          {senderName.charAt(0).toUpperCase()}
                        </div>
                      </div>
                      <span className="font-title-sm text-xs font-semibold text-secondary">
                        {senderName}
                      </span>
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isMe
                        ? 'bg-primary text-on-primary rounded-br-xs shadow-xs'
                        : 'bg-surface-container text-on-surface rounded-bl-xs border border-surface-container-high/40'
                    }`}
                  >
                    {msg.text}
                  </div>

                  {/* Timestamp */}
                  <div className="flex items-center gap-1 mt-0.5 px-1">
                    <span className="text-[10px] text-outline font-medium">
                      {isMe ? 'You • ' : ''}
                      {msg.pending ? 'Sending…' : formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Clear Send Error Alert */}
        {sendError && (
          <div className="mx-space-md mb-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center justify-between shrink-0 animate-fadeIn">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-rose-600">error</span>
              <span>{sendError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="p-1 hover:bg-rose-100 rounded-lg text-rose-700 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {/* Message Input Footer */}
        <form
          onSubmit={handleSendMessage}
          className="p-space-md bg-surface-container-low border-t border-surface-container-high/60 shrink-0"
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (sendError) setSendError(null);
                }}
                onKeyDown={handleKeyDown}
                disabled={isLoading || Boolean(loadError)}
                maxLength={1000}
                placeholder={
                  loadError
                    ? 'Chat unavailable'
                    : 'Type a message... (Press Enter to send)'
                }
                className="w-full py-2.5 pl-3.5 pr-14 rounded-xl bg-surface-container-lowest border border-surface-container-high text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary disabled:opacity-50 transition-all"
              />
              {inputText.length > 800 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-outline font-mono">
                  {1000 - inputText.length}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={!inputText.trim() || isSending || isLoading || Boolean(loadError)}
              className="py-2.5 px-4 rounded-xl bg-primary text-on-primary hover:bg-surface-tint font-title-sm text-xs font-bold transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 active:scale-[0.98]"
            >
              {isSending ? (
                <>
                  <span className="material-symbols-outlined text-sm animate-spin">
                    progress_activity
                  </span>
                  <span>Sending</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-sm">send</span>
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
