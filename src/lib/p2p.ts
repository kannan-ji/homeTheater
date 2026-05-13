import { Peer, DataConnection, MediaConnection } from 'peerjs';

export type MessageType = 'chat' | 'sync' | 'info';

export interface P2PMessage {
  type: MessageType;
  payload: any;
  sender: string;
}

export class P2PManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private streamConnections: Map<string, MediaConnection> = new Map();
  private onMessageCallbacks: ((msg: P2PMessage) => void)[] = [];
  private onPeerJoinedCallbacks: ((peerId: string) => void)[] = [];
  private onPeerLeftCallbacks: ((peerId: string) => void)[] = [];
  private onStreamReceivedCallbacks: ((stream: MediaStream) => void)[] = [];
  private onErrorCallbacks: ((error: any) => void)[] = [];
  private onStatusChangeCallbacks: ((status: string) => void)[] = [];

  constructor(private peerId?: string) {
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
      // For receivers, answer the call with no stream (if they are only watching)
      call.answer();
      call.on('stream', (remoteStream) => {
        console.log('Remote stream received from:', call.peer);
        this.onStreamReceivedCallbacks.forEach(cb => cb(remoteStream));
      });
      
      call.on('error', (err) => {
        console.error('Call error:', err);
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
      this.onPeerJoinedCallbacks.forEach(cb => cb(conn.peer));
    });

    conn.on('data', (data: any) => {
      this.onMessageCallbacks.forEach(cb => cb(data as P2PMessage));
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
    const call = this.peer.call(remoteId, stream);
    this.streamConnections.set(remoteId, call);
  }

  public broadcast(type: MessageType, payload: any) {
    const msg: P2PMessage = { type, payload, sender: this.peer?.id || 'unknown' };
    this.connections.forEach(conn => {
      conn.send(msg);
    });
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
