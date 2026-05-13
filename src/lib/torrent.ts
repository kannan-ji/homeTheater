import WebTorrent from 'webtorrent';

let client: any = null;

export function getTorrentClient(): any {
  if (!client) {
    const WT = typeof WebTorrent === 'function' ? WebTorrent : (window as any).WebTorrent;
    client = new WT();
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

