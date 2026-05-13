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
  const [peerCountOverride, setPeerCountOverride] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'capturing' | 'live' | 'error'>('idle');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isHostRef = useRef(isHost);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    // Check URL for join ID
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    const savedTargetId = roomFromUrl || localStorage.getItem('lastTheaterId');
    if (savedTargetId) setTargetId(savedTargetId);

    const manager = new P2PManager();
    setP2p(manager);

    const checkId = setInterval(() => {
      const id = manager.getMyId();
      if (id) {
        setPeerId(id);
        // If we have a target ID and it was from URL, try to connect automatically
        if (roomFromUrl) {
          manager.connect(roomFromUrl);
          setIsHost(false);
          setIsConnected(true);
        }
        clearInterval(checkId);
      }
    }, 500);

    const addSystemMessage = (text: string) => {
      setChatMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        sender: 'System',
        text,
        timestamp: Date.now()
      }]);
    };

    manager.onMessage((msg: P2PMessage) => {
      if (msg.type === 'chat') {
        const payloadData = typeof msg.payload === 'string' ? { text: msg.payload, originalSender: msg.sender } : msg.payload;
        
        // Skip if it's our own message being relayed back
        if (payloadData.originalSender === manager.getMyId()) return;

        const message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: payloadData.originalSender.slice(0, 5),
          text: payloadData.text,
          timestamp: Date.now()
        };
        setChatMessages(prev => [...prev, message]);
        
        // Host relay: Send to everyone else
        if (isHostRef.current) {
          manager.broadcast('chat', { 
            text: payloadData.text, 
            originalSender: payloadData.originalSender 
          });
        }
      } else if (msg.type === 'sync') {
        setSyncState(msg.payload);
      } else if (msg.type === 'info') {
        if (msg.payload.type === 'peer-count' && !isHostRef.current) {
          setPeerCountOverride(msg.payload.count);
        }
      }
    });

    manager.onPeerJoined((id) => {
      setIsConnected(true);
      setActivePeers(prev => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        
        // Host: Sync peer count to everyone
        if (isHostRef.current) {
          setTimeout(() => {
            manager.broadcast('info', { type: 'peer-count', count: next.length + 1 });
          }, 1000);
        }
        return next;
      });
      addSystemMessage(`User ${id.slice(0, 5)} joined the party!`);

      // If I am the host and I have a stream, call this new peer immediately
      if (isHostRef.current) {
        if (activeStreamRef.current) {
          console.log('Calling new peer with active stream:', id);
          manager.call(id, activeStreamRef.current);
        }
        // Also send current sync state immediately
        const video = document.querySelector('video');
        if (video) {
          setTimeout(() => {
            manager.broadcast('sync', {
              currentTime: video.currentTime,
              paused: video.paused
            });
          }, 1000); // Give connection a second to stabilize
        }
      }
    });

    manager.onPeerLeft((id) => {
      setActivePeers(prev => {
        const next = prev.filter(p => p !== id);
        if (isHostRef.current) {
          manager.broadcast('info', { type: 'peer-count', count: next.length + 1 });
        }
        return next;
      });
      addSystemMessage(`User ${id.slice(0, 5)} left the party.`);
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
      localStorage.setItem('lastTheaterId', targetId);
    }
  };

  const handleSendMessage = () => {
    if (p2p && inputText.trim()) {
      const payload = { text: inputText, originalSender: peerId };
      p2p.broadcast('chat', payload);
      setChatMessages(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        sender: 'You',
        text: inputText,
        timestamp: Date.now()
      }]);
      setInputText('');
    }
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', peerId);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onStreamCreated = (stream: MediaStream) => {
    console.log('Main App: Stream created/updated', stream.id, stream.getTracks().length);
    activeStreamRef.current = stream;
    setStreamStatus('live');
    if (p2p && isHost) {
      activePeers.forEach(peerId => {
        console.log('Calling peer with stream:', peerId);
        p2p.call(peerId, stream);
      });
    }
  };

  const refreshStream = () => {
    // This will trigger the CinemaPlayer to re-run its capture logic if it depends on something
    // Or we can just find the video element and manually capture if needed.
    // For now, let's just log and rely on the player's internal logic which we can nudge.
    const video = document.querySelector('video');
    if (video && isHost && onStreamCreated) {
      console.log('Manually refreshing stream capture...');
      setStreamStatus('capturing');
      // @ts-ignore
      const capture = video.captureStream ? video.captureStream(30) : (video.mozCaptureStream ? video.mozCaptureStream(30) : null);
      if (capture) {
        onStreamCreated(capture);
      } else {
        setStreamStatus('error');
      }
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
                onClick={copyInviteLink}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/5 hover:border-white/10 transition-all text-sm font-medium"
              >
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-zinc-400">ID:</span> {peerId.slice(0, 8)}...
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </button>
            )}
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Users size={16} />
              <span>{peerCountOverride !== null ? peerCountOverride : (activePeers.length + (peerId ? 1 : 0))} Users</span>
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
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold">
                      {isHost ? 'Hosting Local File' : 'Watching Live Stream'}
                    </h3>
                    {isHost && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={refreshStream}
                          className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded border border-white/5 transition-all"
                        >
                          Refresh Stream
                        </button>
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold border border-white/5 ${
                          streamStatus === 'live' ? 'bg-green-500/10 text-green-500' : 
                          streamStatus === 'capturing' ? 'bg-yellow-500/10 text-yellow-500' :
                          streamStatus === 'error' ? 'bg-red-500/10 text-red-500' :
                          'bg-zinc-800 text-zinc-500'
                        }`}>
                          {streamStatus === 'live' && <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                          {streamStatus}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="text-zinc-500 text-sm flex items-center gap-2 mt-1">
                    <span>{isHost ? 'Your friends are watching your shared stream.' : 'Connected to host. Playback is synchronized.'}</span>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-full text-xs font-medium text-zinc-400">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                      {peerCountOverride !== null ? peerCountOverride : (activePeers.length + 1)} { (peerCountOverride !== null ? peerCountOverride : (activePeers.length + 1)) === 1 ? 'person' : 'people'} online
                    </span>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {!isHost && (
                    <button 
                      onClick={() => {
                        localStorage.removeItem('lastTheaterId');
                        window.location.reload();
                      }}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl border border-white/5 transition-all text-sm font-medium"
                    >
                      Leave Party
                    </button>
                  )}
                  <button 
                    onClick={copyInviteLink}
                    className="p-3 bg-black hover:bg-zinc-800 rounded-xl border border-white/5 transition-all group"
                  >
                    {copied ? <Check size={20} className="text-green-500" /> : <Share2 size={20} className="text-zinc-400 group-hover:text-white" />}
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
