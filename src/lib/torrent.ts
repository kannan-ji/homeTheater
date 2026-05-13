import WebTorrent from 'webtorrent';

let client: any = null;

export function getTorrentClient(): any {
  if (!client) {
    const WT = typeof WebTorrent === 'function' ? WebTorrent : (window as any).WebTorrent;
    client = new WT({
      tracker: {
        rtcConfig: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com' },
            { urls: 'stun:stun.sipgate.net:10000' },
            { urls: 'stun:stun.voxgratia.org:3478' },
            { urls: 'stun:stun.stunprotocol.org:3478' },
            {
              urls: [
                'turn:openrelay.metered.ca:80',
                'turn:openrelay.metered.ca:443',
                'turn:openrelay.metered.ca:443?transport=tcp'
              ],
              username: 'openrelayproject',
              credential: 'openrelayproject'
            }
          ]
        }
      }
    });
    client.on('error', (err: any) => {
      console.error('WebTorrent Error:', err);
    });
  }
  return client;
}

export function destroyTorrentClient() {
  if (client) {
    client.destroy();
    client = null;
  }
}

