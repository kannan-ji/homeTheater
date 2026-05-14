import React, { useState, useEffect, useRef } from 'react';
import { Play, Users, Monitor, Link2, Copy, Check, MessageSquare, Send, Film, Share2, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import CinemaPlayer from './components/CinemaPlayer';
import { P2PManager, P2PMessage } from './lib/p2p';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

import { getTorrentClient } from './lib/torrent';

export default function App() {
  const [p2p, setP2p] = useState<P2PManager | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [isHost, setIsHost] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [videoFile, setVideoFile] = useState<string | null>(null);
  const [magnetURI, setMagnetURI] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null); // Keep for compatibility if needed, but not primarily used
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [copied, setCopied] = useState(false);
  const [syncState, setSyncState] = useState<{ currentTime: number; paused: boolean; duration: number }>({ currentTime: 0, paused: true, duration: 1 });
  const [activePeers, setActivePeers] = useState<string[]>([]);
  const [peerCountOverride, setPeerCountOverride] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'capturing' | 'live' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [hostName, setHostName] = useState<string>('');
  const [swarmStats, setSwarmStats] = useState<any>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const isHostRef = useRef(isHost);
  const p2pRef = useRef<P2PManager | null>(null);
  const isChatVisibleRef = useRef(isChatVisible);
  const isMobileRef = useRef(isMobile);

  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    isChatVisibleRef.current = isChatVisible;
  }, [isChatVisible]);

  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  const lastErrorRef = useRef<{ message: string; time: number } | null>(null);
  const greetedPeers = useRef<Set<string>>(new Set());

  const addSystemMessage = (text: string) => {
    // Prevent duplicate error spam
    if (text.startsWith('Error:')) {
      const now = Date.now();
      if (lastErrorRef.current && lastErrorRef.current.message === text && now - lastErrorRef.current.time < 5000) {
        return;
      }
      lastErrorRef.current = { message: text, time: now };
    }

    setChatMessages(prev => {
      // Keep only last 100 messages for performance
      const next = [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        sender: 'Broadcast',
        text,
        timestamp: Date.now()
      }];
      return next.slice(-100);
    });
  };

  const initP2P = (roomToJoin?: string) => {
    if (p2pRef.current && !p2pRef.current.isDestroyed()) return p2pRef.current;
    if (isConnecting) return null;

    setIsConnecting(true);
    setConnectionError(null);

    let manager: P2PManager;
    try {
      manager = new P2PManager();
    } catch (e) {
      console.error('Failed to create P2PManager:', e);
      setIsConnecting(false);
      setConnectionError('Local initialization failed.');
      return null;
    }

    p2pRef.current = manager;
    setP2p(manager);

    let pollingAttempts = 0;
    const checkId = setInterval(() => {
      pollingAttempts++;
      const id = manager.getMyId();
      if (id) {
        setPeerId(id);
        if (roomToJoin) {
          manager.connect(roomToJoin);
          setIsHost(false);
          setIsConnected(true);
        }
        clearInterval(checkId);
        setIsConnecting(false);
      } else if (pollingAttempts > 20) { // 10 seconds timeout
        clearInterval(checkId);
        setIsConnecting(false);
        setConnectionError('Connection timed out.');
      }
    }, 500);

    const errorCleanup = manager.onError(() => {
      clearInterval(checkId);
    });

    manager.onError((err) => {
      console.error('App caught peer error:', err);
      let errorMsg = 'Failed to connect.';
      if (err.type === 'invalid-id' || err.type === 'unavailable-id') {
        errorMsg = 'ID is already taken or unavailable.';
      } else if (err.type === 'network') {
        errorMsg = 'Network error. Please check your connection.';
      } else if (err.type === 'peer-unavailable') {
        errorMsg = 'Target room is not online.';
      } else if (err.message) {
        errorMsg = err.message;
      }
      setConnectionError(errorMsg);
      setIsConnecting(false);
      addSystemMessage(`Error: ${errorMsg}`);
    });

    manager.onStatsUpdate((stats) => {
      setSwarmStats(stats);
    });

    manager.onMessage((msg: P2PMessage) => {
      if (msg.type === 'chat') {
        const payloadData = typeof msg.payload === 'string' ? { text: msg.payload, originalSender: msg.sender } : msg.payload;
        
        // Skip if it's our own message being relayed back
        if (payloadData.originalSender === manager.getMyId()) return;

        const message = {
          id: Math.random().toString(36).substr(2, 9),
          sender: msg.senderName || manager.getPeerName(payloadData.originalSender),
          text: payloadData.text,
          timestamp: Date.now()
        };
        setChatMessages(prev => [...prev, message].slice(-100));
        
        // Handle unread count for mobile floating chat
        if (isMobileRef.current && !isChatVisibleRef.current) {
          setUnreadCount(prev => prev + 1);
        }
      } else if (msg.type === 'handshake') {
        if (msg.payload.displayName) {
          // Deduplicate "Joined" messages using peer ID
          if (greetedPeers.current.has(msg.sender)) return;
          greetedPeers.current.add(msg.sender);

          const urlParams = new URL(window.location.href).searchParams;
          const roomToJoin = urlParams.get('room') || targetId;
          
          if (!isHostRef.current && msg.sender === roomToJoin) {
            setHostName(msg.payload.displayName);
            addSystemMessage(`You have joined ${msg.payload.displayName}'s swarm!`);
          } else {
            addSystemMessage(`${msg.payload.displayName} joined the swarm`);
          }
        }
      } else if (msg.type === 'sync') {
        setSyncState(msg.payload);
      } else if (msg.type === 'info') {
        if (msg.payload.type === 'peer-count' && !isHostRef.current) {
          setPeerCountOverride(msg.payload.count);
        } else if (msg.payload.type === 'magnet' && !isHostRef.current) {
          console.log('Received magnet URI:', msg.payload.magnetURI);
          setMagnetURI(msg.payload.magnetURI);
        }
      } else if (msg.type === 'signal') {
        const payload = msg.payload;
        if (payload?.action === 'redirect') {
          console.log('Redirecting to peer:', payload.targetPeerId);
          addSystemMessage('Room node reached capacity. Connecting to another peer in the swarm...');
          // Connect to the recommended target peer
          manager.connect(payload.targetPeerId);
        }
      }
    });

    manager.onPeerJoined((id) => {
      setIsConnected(true);
      setConnectionError(null);
      setActivePeers(prev => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        
        // Host: Sync peer count to everyone
        if (isHostRef.current) {
          setTimeout(() => {
            // Re-send handshake to ensure everyone knows the host name
            manager.broadcast('handshake', { displayName: manager.displayName });
            manager.broadcast('info', { type: 'peer-count', count: next.length + 1 });
            if (magnetURIRef.current) {
              manager.broadcast('info', { type: 'magnet', magnetURI: magnetURIRef.current });
            }
          }, 1000);
        }
        return next;
      });

      // If I am the host, sync state immediately
      if (isHostRef.current) {
        // Current sync state
        const video = document.querySelector('video');
        if (video) {
          setTimeout(() => {
            manager.broadcast('sync', {
              currentTime: video.currentTime,
              paused: video.paused
            });
          }, 1000);
        }
      }
    });

    manager.onPeerLeft((id) => {
      greetedPeers.current.delete(id);
      setActivePeers(prev => {
        const next = prev.filter(p => p !== id);
        if (isHostRef.current) {
          manager.broadcast('info', { type: 'peer-count', count: next.length + 1 });
        }
        return next;
      });
      addSystemMessage(`User ${manager.getPeerName(id)} left the party.`);
    });

    manager.onStreamReceived((stream) => {
      // Track-based fingerprinting as final safety
      const trackIds = stream.getTracks().map(t => t.id).sort().join(',');
      const existingTrackIds = remoteStreamRef.current?.getTracks().map(t => t.id).sort().join(',');
      
      if (remoteStreamRef.current?.id === stream.id || trackIds === existingTrackIds) {
        console.log('App ignored redundant stream notification');
        return;
      }
      
      console.log('App applying new stream:', stream.id);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      // We set status to live but CinemaPlayer will signal paused if blocked
      setStreamStatus('live');
    });

    return manager;
  };

  useEffect(() => {
    // Check URL for join ID
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    const savedTargetId = roomFromUrl || localStorage.getItem('lastTheaterId');
    if (savedTargetId) setTargetId(savedTargetId);

    // If we have a room URL, initialize and join immediately
    if (roomFromUrl) {
      initP2P(roomFromUrl);
    }

    return () => p2pRef.current?.destroy();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const magnetURIRef = useRef<string | null>(null);

  useEffect(() => {
    magnetURIRef.current = magnetURI;
  }, [magnetURI]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Local Object URL for the host to play instantly
      const url = URL.createObjectURL(file);
      setVideoFile(url);
      setIsHost(true);
      
      addSystemMessage('Seeding file via WebTorrent...');
      const wt = getTorrentClient();
      wt.seed(file, {
        announceList: [
          ["wss://tracker.openwebtorrent.com"],
          ["wss://tracker.btorrent.xyz"],
          ["wss://tracker.fastcast.nz"]
        ]
      }, (torrent: any) => {
        console.log('Client is seeding:', torrent.magnetURI);
        setMagnetURI(torrent.magnetURI);
        // If we already have peers, broadcast immediately
        if (p2pRef.current) {
          p2pRef.current.broadcast('info', { type: 'magnet', magnetURI: torrent.magnetURI });
        }
      });

      initP2P(); // Create room ID only when file is selected
    }
  };

  const handleConnect = () => {
    if (targetId) {
      initP2P(targetId);
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
      }].slice(-100));
      setInputText('');
    }
  };

  const leaveParty = () => {
    localStorage.removeItem('lastTheaterId');
    window.location.href = window.location.pathname; // Reload without search query
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', peerId);
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onStreamCreated = React.useCallback((stream: MediaStream) => {
    console.log('Main App: Local Stream ready (no longer broadcasted over generic WebRTC to save bandwidth for WebTorrent)');
    activeStreamRef.current = stream;
    setStreamStatus('live');
  }, []);

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
        // Force a sync message as well
        onSync({
          currentTime: video.currentTime,
          paused: video.paused,
          duration: video.duration || 1
        });
      } else {
        setStreamStatus('error');
      }
    }
  };

  const onSync = React.useCallback((state: { currentTime: number; paused: boolean; duration: number }) => {
    if (p2pRef.current && isHostRef.current) {
      p2pRef.current.broadcast('sync', state);
    }
  }, []);

  const toggleChat = () => {
    setIsChatVisible(!isChatVisible);
    if (!isChatVisible) {
      setUnreadCount(0);
    }
  };

  const handleGuestPlay = React.useCallback(() => {
    const video = document.querySelector('video');
    if (video) {
      video.muted = false;
      video.play().catch(err => console.error('Manual play failed:', err));
      setStreamStatus('live');
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 selection:bg-red-500/30 selection:text-red-200">
      {/* Autoplay Overlay for Guests */}
      <AnimatePresence>
        {!isHost && isConnected && streamStatus === 'paused' && (remoteStream || magnetURI) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <div className="bg-zinc-900 border border-white/10 p-8 rounded-3xl max-w-sm w-full text-center shadow-2xl">
              <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <Play size={32} fill="currentColor" />
              </div>
              <h2 className="text-2xl font-bold mb-4">Stream Ready</h2>
              <p className="text-zinc-400 mb-8 text-sm">
                The cinema stream has started. Click the button below to join the theater.
              </p>
              <button 
                onClick={handleGuestPlay}
                className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold transition-all shadow-xl shadow-red-600/20 active:scale-95"
              >
                Join Theater
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center shadow-lg shadow-red-600/20">
              <Film size={20} className="text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">homeTheater</h1>
          </div>

          <div className="flex items-center gap-4">
            {p2p && (
              <div className="text-zinc-500 text-[10px] sm:text-sm font-medium flex flex-col items-end sm:flex-row sm:items-center sm:gap-2 text-right">
                <div className="flex items-center gap-1.5">
                  <span className="opacity-70">{isHost ? 'Seeding' : 'Connected'} as</span>
                  <span className="text-red-400 font-bold">{p2p.displayName}</span>
                </div>
                {isHost && videoFile && (
                  <button 
                    onClick={refreshStream}
                    className="p-1 hover:bg-white/10 rounded-md transition-colors text-zinc-400 hover:text-white flex items-center gap-1"
                    title="Refresh stream for all peers"
                  >
                    <RefreshCcw size={12} />
                    <span className="text-[9px] uppercase tracking-wider font-bold">Refresh Stream</span>
                  </button>
                )}
              </div>
            )}
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
              <h2 className="text-2xl font-bold mb-2">Seed a Session</h2>
              <p className="text-zinc-400 mb-8 max-w-[280px]">
                Stream a local video file from your system. Your friends can join via your Swarm ID.
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
              <h2 className="text-2xl font-bold mb-2">Join a Swarm</h2>
              <p className="text-zinc-400 mb-8 max-w-[280px]">
                Already have a Swarm ID? Paste it below to join your friend's cinema swarm.
              </p>
              
              <div className="w-full space-y-4">
                <input 
                  type="text" 
                  placeholder="Paste Room ID here..." 
                  value={targetId}
                  onChange={(e) => {
                    setTargetId(e.target.value);
                    setConnectionError(null);
                  }}
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all font-mono"
                />
                
                <AnimatePresence>
                  {connectionError && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="w-full space-y-3"
                    >
                      <div className="text-red-500 text-xs bg-red-500/10 py-3 px-4 rounded-xl border border-red-500/20">
                        {connectionError}
                      </div>
                      <button 
                        onClick={() => {
                          if (p2pRef.current) p2pRef.current.destroy();
                          const urlParams = new URL(window.location.href);
                          const room = urlParams.searchParams.get('room');
                          if (room) initP2P(room);
                          else if (targetId) initP2P(targetId);
                        }}
                        className="text-xs text-zinc-400 hover:text-white flex items-center justify-center gap-2 mx-auto transition-colors"
                      >
                        <RefreshCcw size={14} />
                        Retry Connection
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button 
                  onClick={handleConnect}
                  disabled={!targetId || isConnecting}
                  className="w-full py-4 px-6 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                      Connecting...
                    </>
                  ) : 'Enter Swarm'}
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
                magnetURI={magnetURI || undefined}
                onStreamCreated={onStreamCreated}
                onPlaybackBlocked={() => setStreamStatus('paused')}
                onSync={onSync}
                syncState={syncState}
                isHost={isHost}
              />
              
              <div className="p-6 bg-zinc-900/50 border border-white/5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="w-full sm:w-auto">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <h3 className="text-lg font-bold">
                      {isHost ? 'Seeding Local File' : 'Connected to Swarm'}
                    </h3>
                    {isHost && (
                      <div className="flex items-center gap-2">
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
                  <div className="text-zinc-500 text-sm flex flex-col sm:flex-row sm:items-center gap-2 mt-2 sm:mt-1">
                    {!isHost && <span>{`Connected to ${hostName || 'Seeder'}'s live stream.`}</span>}
                    {isConnected && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/5 rounded-full text-xs font-medium text-zinc-400 w-fit">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                        {(() => {
                          const count = peerCountOverride !== null ? peerCountOverride : (activePeers.length + 1);
                          if (count <= 1) return "you are online";
                          if (count === 2) return "you and 1 other person is online";
                          return `you and ${count - 1} other persons are online`;
                        })()}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex gap-3 w-full sm:w-auto justify-end">
                  {!isHost ? (
                    <button 
                      onClick={leaveParty}
                      className="px-4 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-xl border border-red-500/20 transition-all text-sm font-medium"
                    >
                      Leave Swarm
                    </button>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <button 
                        onClick={copyInviteLink}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-lg shadow-red-600/20 text-sm font-bold w-full sm:w-auto bg-nowrap min-w-[180px]"
                      >
                        {copied ? <Check size={18} /> : <Share2 size={18} />}
                        {copied ? 'Copied Invite Link!' : 'Share Swarm Link'}
                      </button>
                      <button 
                        onClick={refreshStream}
                        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl border border-white/5 transition-all text-sm font-medium w-full sm:w-auto min-w-[150px]"
                      >
                        <RefreshCcw size={16} className="text-zinc-400" />
                        Reset Stream
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!isHost && isConnected && !remoteStream && !magnetURI && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-red-500 text-sm">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span>Stream not received yet. This can happen on some networks.</span>
                  </div>
                </div>
              )}
              {!isHost && isConnected && magnetURI && streamStatus !== 'live' && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-yellow-500 text-sm">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    <span>Downloading torrent and connecting to peers. This may take a minute...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Section */}
            <div className="relative">
              <AnimatePresence>
                {(isChatVisible || !isMobile) && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    className={`
                      flex flex-col bg-zinc-950 lg:bg-zinc-900/50 border border-white/10 lg:border-white/5 rounded-3xl overflow-hidden
                      ${isChatVisible ? 'fixed inset-4 z-[60] h-auto lg:relative lg:inset-auto lg:h-[600px] lg:z-0' : 'hidden lg:flex h-[600px] sticky top-24'}
                    `}
                  >
                    <div className="p-4 border-b border-white/5 bg-black/20 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={18} className="text-red-500" />
                        <span className="font-bold text-sm">Live Chat</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isConnected && (
                          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-green-500/10 rounded-full text-[10px] font-bold text-green-500 uppercase tracking-wider">
                            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                            Connected
                          </div>
                        )}
                        <button 
                          onClick={() => setIsChatVisible(false)}
                          className="lg:hidden p-1 hover:bg-white/10 rounded"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
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
                          <p className="text-sm text-zinc-300 leading-relaxed bg-black/20 p-2 rounded-lg border border-white/5 break-words overflow-hidden">
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
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mobile Chat Floating Button */}
              {!isChatVisible && (
                <motion.button
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  onClick={toggleChat}
                  className="lg:hidden fixed bottom-6 right-6 z-50 w-14 h-14 bg-red-600 text-white rounded-full shadow-2xl shadow-red-600/40 flex items-center justify-center border border-white/10"
                >
                  <MessageSquare size={24} />
                  <AnimatePresence>
                    {unreadCount > 0 && (
                      <motion.div 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1 -right-1 bg-white text-red-600 text-xs font-bold w-6 h-6 rounded-full border-2 border-red-600 flex items-center justify-center shadow-lg"
                      >
                        {unreadCount}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              )}
            </div>
          </div>
        )}
        
        {/* Swarm Dashboard (Debugging & Status) */}
        {isConnected && swarmStats && (
          <div className="mt-8 border-t border-white/5 pt-8">
            <div className="flex items-center gap-2 mb-4 text-zinc-500">
              <Users size={16} />
              <h4 className="text-xs font-bold uppercase tracking-widest">Swarm Health Dashboard</h4>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Network Topology</p>
                <div className="text-sm font-medium">
                  {swarmStats.parents > 0 ? 'Relay Node' : 'Root Seeder'}
                  <span className="text-zinc-600 block text-[10px] font-mono mt-0.5">{swarmStats.peerId?.slice(0, 8)}...</span>
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Downstream Peers</p>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{swarmStats.children}</span>
                  <span className="text-[10px] text-zinc-600">Peers following you</span>
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Stream Status</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${swarmStats.activeStream && swarmStats.tracks > 0 ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-sm font-medium">{swarmStats.activeStream ? `${swarmStats.tracks} Tracks` : 'No Signal'}</span>
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Time Sync</p>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${syncState.paused ? 'bg-zinc-600' : 'bg-green-500'}`} />
                  <span className="text-sm font-medium">{syncState.paused ? 'Paused' : 'Playing'}</span>
                  <span className="text-[10px] text-zinc-600 font-mono">@{Math.floor(syncState.currentTime)}s</span>
                </div>
              </div>
              <div className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
                <p className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Avg Latency</p>
                <p className="text-sm font-medium">
                  {swarmStats.latencies && Object.keys(swarmStats.latencies).length > 0 
                    ? `${Math.round(Object.values(swarmStats.latencies).reduce((a: any, b: any) => a + b, 0) as number / Object.keys(swarmStats.latencies).length)} ms`
                    : '--'}
                </p>
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
