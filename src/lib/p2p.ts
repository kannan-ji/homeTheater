import { Peer, DataConnection, MediaConnection } from 'peerjs';

export type MessageType = 'chat' | 'sync' | 'info' | 'signal' | 'handshake';

export interface P2PMessage {
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
  private streamConnections: Map<string, MediaConnection> = new Map();
  private peerNames: Map<string, string> = new Map();
  private onMessageCallbacks: ((msg: P2PMessage) => void)[] = [];
  private onPeerJoinedCallbacks: ((peerId: string) => void)[] = [];
  private onPeerLeftCallbacks: ((peerId: string) => void)[] = [];
  private onStreamReceivedCallbacks: ((stream: MediaStream) => void)[] = [];
  private onErrorCallbacks: ((error: any) => void)[] = [];
  private onStatusChangeCallbacks: ((status: string) => void)[] = [];
  public displayName: string;

  constructor(private peerId?: string) {
    this.displayName = generateRandomName();
    this.init();
  }

  private init() {
    this.peer = new Peer(this.peerId, {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          { urls: 'stun:stun.ekiga.net' },
          { urls: 'stun:stun.ideasip.com' },
          { urls: 'stun:stun.schlund.de' },
          { urls: 'stun:stun.voipstunt.com' },
          { urls: 'stun:stun.voxgratia.org' },
          { urls: 'stun:stun.xten.com' },
        ],
      },
    });

    this.peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      this.onStatusChangeCallbacks.forEach(cb => cb('ready'));
    });

    this.peer.on('connection', (conn) => {
      this.handleDataConnection(conn);
    });

    this.peer.on('call', (call) => {
      console.log('Incoming call from:', call.peer);
      
      // Safety check: close previous call from same peer if any
      const existingCall = this.streamConnections.get(call.peer);
      if (existingCall) {
        console.log('Closing stale call from:', call.peer);
        existingCall.close();
      }

      call.answer();
      call.on('stream', (remoteStream) => {
        console.log('Remote stream received from:', call.peer, 'Tracks:', remoteStream.getTracks().length);
        this.onStreamReceivedCallbacks.forEach(cb => cb(remoteStream));
      });
      
      call.on('error', (err) => {
        console.error('Call error from ' + call.peer + ':', err);
      });

      this.streamConnections.set(call.peer, call);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error:', err);
      this.onErrorCallbacks.forEach(cb => cb(err));
    });
  }

  private handleDataConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      // Send handshake immediately
      conn.send({ 
        type: 'handshake', 
        payload: { displayName: this.displayName }, 
        sender: this.peer?.id 
      });
      this.onPeerJoinedCallbacks.forEach(cb => cb(conn.peer));
    });

    conn.on('data', (data: any) => {
      const msg = data as P2PMessage;
      if (msg.type === 'handshake') {
        if (msg.payload.displayName) {
          this.peerNames.set(msg.sender, msg.payload.displayName);
        }
      }
      this.onMessageCallbacks.forEach(cb => cb(msg));
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
      this.onErrorCallbacks.forEach(cb => cb(err));
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this.onPeerLeftCallbacks.forEach(cb => cb(conn.peer));
    });
  }

  public connect(remoteId: string) {
    if (!this.peer) return;
    const conn = this.peer.connect(remoteId);
    this.handleDataConnection(conn);
  }

  public call(remoteId: string, stream: MediaStream) {
    if (!this.peer) return;
    
    // Safety check: close previous call to same peer
    const existingCall = this.streamConnections.get(remoteId);
    if (existingCall) {
      console.log('Closing existing call to:', remoteId);
      existingCall.close();
    }

    console.log('Initiating call to:', remoteId);
    const call = this.peer.call(remoteId, stream);
    
    call.on('error', (err) => {
      console.error('Call outgoing error to ' + remoteId + ':', err);
    });

    this.streamConnections.set(remoteId, call);
  }

  public broadcast(type: MessageType, payload: any, senderId?: string, senderName?: string) {
    const msg: P2PMessage = { 
      type, 
      payload, 
      sender: senderId || this.peer?.id || 'unknown',
      senderName: senderName || this.displayName
    };
    this.connections.forEach(conn => {
      conn.send(msg);
    });
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
    this.peer?.destroy();
  }
}
