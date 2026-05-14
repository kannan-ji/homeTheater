import { Peer, DataConnection, MediaConnection } from 'peerjs';

export type MessageType = 'chat' | 'sync' | 'info' | 'signal' | 'handshake';

export interface P2PMessage {
  id?: string;
  type: MessageType;
  payload: any;
  sender: string;
  senderName?: string;
}

const ADJECTIVES = ['Silent', 'Cool', 'Epic', 'Brave', 'Wild', 'Chill', 'Fast', 'Hyper', 'Neon', 'Lunar'];
const NOUNS = ['Watcher', 'Cinephile', 'Viewer', 'Fan', 'Ghost', 'Rider', 'Pilot', 'Nomad', 'Star', 'Blade'];

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${noun}${num}`;
}

export class P2PManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private children: Set<string> = new Set();
  private parentPeerId: string | null = null;
  private streamConnections: Map<string, MediaConnection> = new Map();
  private connectionRequestTimes: Map<string, number> = new Map();
  private peerNames: Map<string, string> = new Map();
  private activeStream: MediaStream | null = null;
  private maxOutgoingStreams: number = 8;
  private seenMessages: Set<string> = new Set();
  private reconnectTimeout: any = null;
  private forwardThrottles: Map<string, number> = new Map();
  private latencies: Map<string, number> = new Map();
  private onMessageCallbacks: ((msg: P2PMessage) => void)[] = [];
  private onPeerJoinedCallbacks: ((peerId: string) => void)[] = [];
  private onPeerLeftCallbacks: ((peerId: string) => void)[] = [];
  private onStreamReceivedCallbacks: ((stream: MediaStream) => void)[] = [];
  private onErrorCallbacks: ((error: any) => void)[] = [];
  private onStatusChangeCallbacks: ((status: string) => void)[] = [];
  private onStatsUpdateCallbacks: ((stats: any) => void)[] = [];
  public displayName: string;

  private heartbeatInterval: any = null;
  private statsInterval: any = null;

  constructor(private peerId?: string) {
    this.displayName = generateRandomName();
    this.init();
    this.startHeartbeat();
    this.startStatsReporting();
  }

  private startStatsReporting() {
    this.statsInterval = setInterval(() => {
      const stats = {
        peers: this.connections.size,
        children: this.children.size,
        parents: this.parentPeerId ? 1 : 0,
        activeStream: !!this.activeStream,
        tracks: this.activeStream ? this.activeStream.getTracks().length : 0,
        peerId: this.peer?.id,
        latencies: Object.fromEntries(this.latencies)
      };
      this.onStatsUpdateCallbacks.forEach(cb => cb(stats));
    }, 2000);
  }

  public onStatsUpdate(callback: (stats: any) => void) {
    this.onStatsUpdateCallbacks.push(callback);
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.peer && !this.peer.destroyed) {
        // Forced Re-initialization Check
        const now = Date.now();
        let stalled = false;
        this.connectionRequestTimes.forEach((startTime, peerId) => {
          if (now - startTime > 5000 && !this.streamConnections.has(peerId)) {
            console.error(`Connection stalled for peer ${peerId} ( > 5s ). Forcing Peer node re-init.`);
            stalled = true;
          }
        });
        if (stalled) {
          this.reInitializePeer();
          return;
        }

        if (this.connections.size > 0) {
          this.broadcast('signal', { action: 'heartbeat', timestamp: now });
          // Also ping individually for latency tracking
          this.connections.forEach(conn => {
            conn.send({
              id: 'ping-' + Math.random().toString(36).substr(2, 5),
              type: 'signal',
              payload: { action: 'ping', sentAt: now },
              sender: this.peer?.id || 'unknown'
            });
          });
        }
      }
    }, 10000); 
  }

  private reInitializePeer() {
    console.log('Forced re-initialization of PeerJS node.');
    this.destroy(); // Destroy old
    this.init(); // Init new
  }

  private hardCloseCall(call: MediaConnection) {
    console.log(`Aggressive closing of call to: ${call.peer}`);
    try {
      // Remove all local listeners first
      (call as any).removeAllListeners && (call as any).removeAllListeners();
      call.close();
    } catch (e) {
      console.error(`Error during hard close of call to ${call.peer}`, e);
    }
  }

  private init() {
    try {
      console.log('Initializing PeerJS node...');
      this.peer = new Peer(this.peerId, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com' },
            { urls: 'stun:stun.sipgate.net:10000' },
            { urls: 'stun:stun.voxgratia.org:3478' },
            { urls: 'stun:stun.stunprotocol.org:3478' }
          ],
          iceTransportPolicy: 'all',
          iceCandidatePoolSize: 10,
        },
        debug: 3
      });

      if (!this.peer) {
        throw new Error('Peer constructor returned undefined');
      }

      this.peer.on('open', (id) => {
        console.log('My peer ID is: ' + id);
        this.onStatusChangeCallbacks.forEach(cb => cb('ready'));
      });

      this.peer.on('disconnected', () => {
        console.warn('Peer disconnected from signaling server. Attempting to reconnect...');
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        
        this.reconnectTimeout = setTimeout(() => {
          if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
            try {
              this.peer.reconnect();
            } catch (e) {
              console.error('Reconnect failed:', e);
            }
          }
        }, 2000 + Math.random() * 3000);
      });

      this.peer.on('connection', (conn) => {
        if (conn) this.handleDataConnection(conn);
      });

      this.peer.on('call', (call) => {
        if (!call) return;
        
        // Safety check: if I already have an active call producing a stream from this peer, 
        // close it to accept the new incoming call (e.g. for reconnection/re-sync).
        const existingCall = this.streamConnections.get(call.peer);
        if (existingCall) {
           console.log('Closing existing call from ' + call.peer + ' to accept new one.');
           this.hardCloseCall(existingCall);
           this.streamConnections.delete(call.peer);
        }

        console.log('Incoming call from:', call.peer);
        call.answer();
        
        call.on('stream', (remoteStream) => {
          this.connectionRequestTimes.delete(call.peer);
          console.log(`Stream received from: ${call.peer}, ID: ${remoteStream.id}`);
          remoteStream.getTracks().forEach(track => {
            console.log(`Track: ${track.kind}, ID: ${track.id}, Enabled: ${track.enabled}`);
          });
          this.activeStream = remoteStream;
          this.onStreamReceivedCallbacks.forEach(cb => cb(remoteStream));
          
          // FORWARDING: Re-stream to my connected peers automatically
          this.forwardStream(remoteStream);
        });
        
        call.on('close', () => {
          console.log(`Call closed with ${call.peer}`);
          if (this.streamConnections.get(call.peer) === call) {
            this.streamConnections.delete(call.peer);
          }
        });

        call.on('error', (err) => {
          console.error('Call error from ' + call.peer + ':', err);
        });

        this.streamConnections.set(call.peer, call);
      });

      this.peer.on('error', (err) => {
        console.error('Peer error event:', err);
        if (err.type === 'disconnected') return;
        this.onErrorCallbacks.forEach(cb => cb(err));
      });
    } catch (e) {
      console.error('Failed to initialize Peer:', e);
    }
  }

  private handleDataConnection(conn: DataConnection, isIncoming: boolean = true) {
    if (!conn) return;

    conn.on('open', () => {
      // REDIRECTION LOGIC: Only apply to incoming connections (potential children)
      if (isIncoming && this.children.size >= this.maxOutgoingStreams) {
        console.log('At capacity. Redirecting peer:', conn.peer);
        const childrenArray = Array.from(this.children);
        const target = childrenArray[Math.floor(Math.random() * childrenArray.length)];
        
        conn.send({
          id: Math.random().toString(36).substr(2, 9),
          type: 'signal',
          payload: { action: 'redirect', targetPeerId: target },
          sender: this.peer?.id || 'unknown'
        });

        // Close connection after a short delay
        setTimeout(() => conn.close(), 1000);
        return;
      }

      this.connections.set(conn.peer, conn);
      if (isIncoming) {
        this.children.add(conn.peer);
      }
      
      // Send handshake
      conn.send({ 
        id: Math.random().toString(36).substr(2, 9),
        type: 'handshake', 
        payload: { displayName: this.displayName }, 
        sender: this.peer?.id || 'unknown'
      });

      // If I already have a stream, call the new peer (if it's a child)
      if (this.activeStream && isIncoming) {
        setTimeout(() => {
          if (this.activeStream && this.connections.has(conn.peer)) {
            console.log('Handshake done, starting stream call to:', conn.peer);
            this.call(conn.peer, this.activeStream);
          }
        }, 800); // 800ms delay to let ICE stabilize on DataConnection
      }

      this.onPeerJoinedCallbacks.forEach(cb => cb(conn.peer));
    });

    conn.on('data', (data: any) => {
      const msg = data as P2PMessage;
      
      // RELAY LOOP PREVENTION
      if (msg.id && this.seenMessages.has(msg.id)) return;
      if (msg.id) {
        this.seenMessages.add(msg.id);
        // Keep set size manageable
        if (this.seenMessages.size > 200) {
          const first = this.seenMessages.values().next().value;
          if (first) this.seenMessages.delete(first);
        }
      }

      if (msg.type === 'handshake') {
        if (msg.payload.displayName) {
          this.peerNames.set(msg.sender, msg.payload.displayName);
        }
      }

      if (msg.type === 'signal') {
        const payload = msg.payload;
        if (payload?.action === 'ready-to-stream' && this.activeStream) {
          console.log('Peer requested stream resync:', msg.sender);
          const existing = this.streamConnections.get(msg.sender);
          if (existing) {
            try { existing.close(); } catch (e) {}
            this.streamConnections.delete(msg.sender);
          }
          // Small delay before retry to ensure cleanup
          setTimeout(() => {
            if (this.activeStream && this.connections.has(msg.sender)) {
              this.call(msg.sender, this.activeStream);
            }
          }, 800);
        }
        if (payload?.action === 'ping') {
          conn.send({
            id: Math.random().toString(36).substr(2, 9),
            type: 'signal',
            payload: { action: 'pong', pingId: msg.id, sentAt: payload.sentAt },
            sender: this.peer?.id || 'unknown'
          });
        }
        if (payload?.action === 'pong') {
          const sentAt = payload.sentAt;
          if (sentAt) {
            this.latencies.set(msg.sender, Date.now() - sentAt);
          }
        }
      }

      // RELAY to others (excluding the one who sent it)
      this.relay(msg, conn.peer);
      
      this.onMessageCallbacks.forEach(cb => cb(msg));
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      this.onErrorCallbacks.forEach(cb => cb(err));
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.children.delete(conn.peer);
      if (conn.peer === this.parentPeerId) {
        this.parentPeerId = null;
      }
      this.onPeerLeftCallbacks.forEach(cb => cb(conn.peer));
    });
  }

  private forwardStream(stream: MediaStream, force: boolean = false) {
    const now = Date.now();
    console.log(`Forwarding stream to ${this.children.size} children ${force ? '(FORCED)' : ''}`);
    this.children.forEach((peerId) => {
      // Throttle forwards to the same peer to avoid spamming calls
      const lastForward = this.forwardThrottles.get(peerId) || 0;
      if (!force && now - lastForward < 5000) { // 5 second cool-down per child (skipped if forced)
        return;
      }
      this.forwardThrottles.set(peerId, now);
      this.call(peerId, stream);
    });
  }

  public setLocalStream(stream: MediaStream) {
    console.log('Setting local stream! Closing old outgoing stream connections to force negotiation.');
    this.streamConnections.forEach((call, peerId) => {
      try { call.close(); } catch (e) {}
    });
    this.streamConnections.clear();
    
    this.activeStream = stream;
    this.forwardStream(stream, true); // Force allow manual refresh
  }

  public connect(remoteId: string) {
    if (!this.peer || this.peer.destroyed) {
      console.warn('Cannot connect: Peer is destroyed or not initialized');
      return;
    }
    
    if (this.peer.disconnected) {
      console.warn('Peer is disconnected from signaling server, attempting reconnect...');
      try {
        this.peer.reconnect();
      } catch (e) {
        console.error('Reconnect failed during connect:', e);
      }
      return;
    }

    try {
      this.parentPeerId = remoteId;
      const conn = this.peer.connect(remoteId);
      if (conn) this.handleDataConnection(conn, false); // Not incoming (it's my parent)
    } catch (e) {
      console.error('Connect failed:', e);
    }
  }

  public call(remoteId: string, stream: MediaStream) {
    if (!this.peer || this.peer.destroyed) {
      console.warn('Cannot call: Peer is destroyed or not initialized');
      return;
    }
    
    if (this.peer.disconnected) {
      console.warn('Peer is disconnected from signaling server, attempting reconnect...');
      try {
        this.peer.reconnect();
      } catch (e) {
        console.error('Reconnect failed during call:', e);
      }
      return;
    }
    
    // Safety check: If I already have an open call to this peer with the same stream, skip
    const existingCall = this.streamConnections.get(remoteId);
    if (existingCall && existingCall.open) {
      console.log('Already have an active call to:', remoteId);
      return;
    }

    console.log('Initiating call to:', remoteId);
    this.connectionRequestTimes.set(remoteId, Date.now());
    try {
      const call = this.peer.call(remoteId, stream);
      if (call) {
        call.on('error', (err) => {
          console.error('Call outgoing error to ' + remoteId + ':', err);
        });
        this.streamConnections.set(remoteId, call);
      }
    } catch (e) {
      console.error('Call failed:', e);
    }
  }

  public broadcast(type: MessageType, payload: any, senderId?: string, senderName?: string) {
    const id = Math.random().toString(36).substr(2, 9);
    this.seenMessages.add(id);

    const msg: P2PMessage = { 
      id,
      type, 
      payload, 
      sender: senderId || this.peer?.id || 'unknown',
      senderName: senderName || this.displayName
    };
    this.connections.forEach(conn => {
      conn.send(msg);
    });
  }

  private relay(msg: P2PMessage, excludePeerId: string) {
    // Only relay certain messages in the tree
    if (msg.type === 'chat' || msg.type === 'sync' || msg.type === 'info') {
      this.connections.forEach((conn, peerId) => {
        if (peerId !== excludePeerId) {
          conn.send(msg);
        }
      });
    }
  }

  public getPeerName(id: string): string {
    return this.peerNames.get(id) || id.slice(0, 5);
  }

  public getMyId(): string | undefined {
    return this.peer?.id;
  }

  public onMessage(cb: (msg: P2PMessage) => void) {
    this.onMessageCallbacks.push(cb);
  }

  public onPeerJoined(cb: (peerId: string) => void) {
    this.onPeerJoinedCallbacks.push(cb);
  }

  public onPeerLeft(cb: (peerId: string) => void) {
    this.onPeerLeftCallbacks.push(cb);
  }

  public onStreamReceived(cb: (stream: MediaStream) => void) {
    this.onStreamReceivedCallbacks.push(cb);
  }

  public onError(cb: (error: any) => void) {
    this.onErrorCallbacks.push(cb);
  }

  public onStatusChange(cb: (status: string) => void) {
    this.onStatusChangeCallbacks.push(cb);
  }

  public destroy() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.statsInterval) clearInterval(this.statsInterval);
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }

  public isDestroyed() {
    return !this.peer || this.peer.destroyed;
  }
}
