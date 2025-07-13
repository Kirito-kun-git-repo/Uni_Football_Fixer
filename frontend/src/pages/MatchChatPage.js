import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import socket from '../api/socket';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

function MatchChatPage() {
  const { id } = useParams(); // matchId
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // Fetch chat history
    const fetchHistory = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api.get(`/chat/matches/${id}`);
        setMessages(res.data);
      } catch (err) {
        setError('Failed to load chat history');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [id]);

  useEffect(() => {
    // Connect and join room
    socket.connect();
    socket.emit('joinMatch', { matchId: id, teamId: user?._id });
    socket.on('chatMessage', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => {
      socket.emit('leaveMatch', { matchId: id, teamId: user?._id });
      socket.off('chatMessage');
      socket.disconnect();
    };
    // eslint-disable-next-line
  }, [id, user?._id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const msg = {
      matchId: id,
      sender: { teamName: user?.teamName, collegeName: user?.collegeName, _id: user?._id },
      message: input,
      timestamp: new Date().toISOString(),
    };
    socket.emit('chatMessage', msg);
    setInput('');
  };

  if (loading) return <div>Loading chat...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <h2>Match Chat</h2>
      <div style={{ border: '1px solid #ccc', padding: 16, height: 400, overflowY: 'auto', background: '#f9f9f9' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div><strong>{msg.sender?.teamName || 'Unknown'} ({msg.sender?.collegeName || 'Unknown'})</strong></div>
            <div>{msg.message}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{new Date(msg.timestamp).toLocaleString()}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSend} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1 }}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default MatchChatPage;
