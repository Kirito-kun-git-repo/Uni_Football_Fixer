import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import chatService from '../../api/chatService';
import { useSocket } from '../../context/SocketContext';

const MatchChat = () => {
  const { id: matchId } = useParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const socketContext = useSocket();
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      try {
        const data = await chatService.getMessages(matchId);
        setMessages(data || []);
      } catch (err) {
        setError('Failed to load messages');
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
  }, [matchId]);

  useEffect(() => {
    if (!socketContext.socket) return;
    const handleNewMessage = (msg) => {
      if (msg.matchId === matchId) {
        setMessages((prev) => [...prev, msg]);
      }
    };
    socketContext.socket.on('chatMessage', handleNewMessage);
    return () => {
      socketContext.socket.off('chatMessage', handleNewMessage);
    };
  }, [socketContext.socket, matchId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setSending(true);
    try {
      await chatService.sendMessage(matchId, input);
      setInput('');
      // The new message will come via socket event
    } catch (err) {
      setError('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="p-8">Loading chat...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white shadow rounded flex flex-col h-[500px]">
      <h2 className="text-2xl font-bold mb-4">Match Chat</h2>
      <div className="flex-1 overflow-y-auto mb-4 border rounded p-2 bg-gray-50">
        {messages.length === 0 ? (
          <div className="text-gray-500">No messages yet.</div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className="mb-2">
              <span className="font-semibold">{msg.sender || 'User'}:</span> {msg.text}
              <span className="ml-2 text-xs text-gray-400">{msg.time ? new Date(msg.time).toLocaleTimeString() : ''}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          className="flex-1 border px-3 py-2 rounded"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={sending}
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          disabled={sending}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default MatchChat;
