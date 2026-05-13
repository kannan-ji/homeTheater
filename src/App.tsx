import React, { useState, useEffect, useRef } from 'react';
import { Play, Users, Monitor, Link2, Copy, Check, MessageSquare, Send, Film, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import CinemaPlayer from './components/CinemaPlayer';
import { P2PManager, P2PMessage } from './lib/p2p';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export default function App() {
  const [p2p, setP2p] = useState<P2PManager | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [videoFile, setVideoFile] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<{ currentTime: number; paused: boolean }>({ currentTime: 0, paused: true });
  const [activePeers, setActivePeers] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const manager = new P2PManager();
    setP2p(manager);

    const checkId = setInterval(() => {
      const id = manager.getMyId();
      if (id) {
        setPeerId(id);
        clearInterval(checkId);
      }
    }, 500);

    manager.onMessage((msg: P2PMessage) => {
      if (msg.type === 'chat') {
        setChatMessages(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          sender: msg.sender.slice(0, 5),
          text: msg.payload,
          timestamp: Date.now()
        }]);
      } else if (msg.type === 'sync') {
        setSyncState(msg.payload);
      }
    });

    manager.onPeerJoined((id) => {
      setIsConnected(true);
      setActivePeers(prev => [...prev, id]);
    });

    manager.onPeerLeft((id) => {
      setActivePeers(prev => prev.filter(p => p !== id));
      if (activePeers.length <= 1) setIsConnected(false);
    });

    manager.onStreamReceived((stream) => {
      console.log('Stream received!');
      setRemoteStream(stream);
    });

    return () => manager.destroy();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(url);
      setIsHost(true);
    }
  };

  const handleConnect = () => {
    if (p2p && targetId) {
      p2p.connect(targetId);
      setIsHost(false);
      setIsConnected(true);
    }
  };

  const handleSendMessage = () => {
    if (p2p && inputText.trim()) {
      p2p.broadcast('chat', inputText);
      setChatMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        sender: 'You',
        text: inputText,
        timestamp: Date.now()
      }]);
      setInputText('');
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onStreamCreated = (stream: MediaStream) => {
    if (p2p && isHost) {
      activePeers.forEach(peerId => {
        p2p.call(peerId, stream);
      });
    }
  };

  const onSync = (state: { currentTime: number; paused: boolean }) => {
    if (p2p && isHost) {
      p2p.broadcast('sync', state);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 selection:bg-red-500/30 selection:text-red-200">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center shadow-lg shadow-red-600/20">
              <Film size={20} className="text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">homeTheater</h1>
          </div>

          <div className="flex items-center gap-4">
            {peerId && (
              <button 
                onClick={copyId}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/5 hover:border-white/10 transition-all text-sm font-medium"
              >
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-zinc-400">ID:</span> {peerId.slice(0, 8)}...
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            )}
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Users size={16} />
              <span>{activePeers.length + (peerId ? 1 : 0)} Users</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 lg:p-12">
        {!isConnected && !videoFile ? (
          <div className="max-w-4xl mx-auto mt-12 grid md:grid-cols-2 gap-8">
            {/* Host Section */}
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-zinc-900/50 border border-white/5 p-8 rounded-3xl flex flex-col items-center text-center group hover:border-red-500/30 transition-all"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mb-6 group-hover:scale-110 transition-transform">
                <Monitor size={32} />
              </div>
              <h2 className="text-2xl font-bold mb-2">Host a Session</h2>
              <p className="text-zinc-400 mb-8 max-w-[280px]">
                Stream a local video file from your system. Your friends can join via your Room ID.
              </p>
              
              <label className="w-full">
                <input 
                  type="file" 
                  accept="video/*" 
                  onChange={handleFileChange} 
                  className="hidden" 
                />
                <div className="w-full py-4 px-6 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-xl shadow-red-600/20 active:scale-95">
                  Select Video File
                </div>
              </label>
              <p className="mt-4 text-xs text-zinc-500">Video remains local, only stream data is shared.</p>
            </motion.div>

            {/* Join Section */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-zinc-900/50 border border-white/5 p-8 rounded-3xl flex flex-col items-center text-center group hover:border-white/20 transition-all"
            >
              <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
                <Link2 size={32} />
              </div>
              <h2 className="text-2xl font-bold mb-2">Join a Session</h2>
              <p className="text-zinc-400 mb-8 max-w-[280px]">
                Already have a Room ID? Paste it below to join your friend's cinema room.
              </p>
              
              <div className="w-full space-y-4">
                <input 
                  type="text" 
                  placeholder="Paste Room ID here..." 
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all"
                />
                <button 
                  onClick={handleConnect}
                  disabled={!targetId}
                  className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition-all active:scale-95"
                >
                  Join Room
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-4 gap-8">
            <div className="lg:col-span-3 space-y-6">
              <CinemaPlayer 
                src={videoFile || undefined} 
                stream={remoteStream || undefined}
                onStreamCreated={onStreamCreated}
                onSync={onSync}
                syncState={syncState}
                isHost={isHost}
              />
              
              <div className="p-6 bg-zinc-900/50 border border-white/5 rounded-2xl flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold mb-1">
                    {isHost ? 'Hosting Local File' : 'Watching Live Stream'}
                  </h3>
                  <p className="text-zinc-500 text-sm">
                    {isHost ? 'Your friends are watching your shared stream.' : 'Connected to host. Playback is synchronized.'}
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={copyId}
                    className="p-3 bg-black hover:bg-zinc-800 rounded-xl border border-white/5 transition-all group"
                  >
                    <Share2 size={20} className="text-zinc-400 group-hover:text-white" />
                  </button>
                </div>
              </div>
            </div>

            {/* Chat Section */}
            <div className="flex flex-col h-[600px] lg:h-auto bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
              <div className="p-4 border-b border-white/5 bg-black/20 flex items-center gap-2">
                <MessageSquare size={18} className="text-red-500" />
                <span className="font-bold text-sm">Live Chat</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatMessages.length === 0 && (
                  <div className="h-full flex items-center justify-center text-zinc-600 text-sm italic">
                    No messages yet... say hi!
                  </div>
                )}
                {chatMessages.map(msg => (
                  <div key={msg.id} className="group">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-bold text-xs text-red-400">{msg.sender}</span>
                      <span className="text-[10px] text-zinc-600 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed bg-black/20 p-2 rounded-lg border border-white/5">
                      {msg.text}
                    </p>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="p-4 bg-black/40 border-t border-white/5">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="Type a message..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    className="w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all text-sm"
                  />
                  <button 
                    onClick={handleSendMessage}
                    className="absolute right-2 top-1.5 p-2 bg-red-600 rounded-lg hover:bg-red-500 transition-colors"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-20 py-12 border-t border-white/5 text-center text-zinc-600 text-sm">
        <p>© 2026 homeTheater. P2P Powered Cinema.</p>
      </footer>
    </div>
  );
}
