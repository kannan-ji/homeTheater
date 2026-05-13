# homeTheater - P2P Watch Party

homeTheater is a real-time, peer-to-peer (P2P) watch party application that allows you to stream local video files from your system to friends without uploading them to a central server.

## Features

- **P2P Video Streaming**: Stream local video files directly from your browser to peers.
- **Synchronized Playback**: Host-controlled playback ensures everyone watches at the exact same moment.
- **Live Chat**: Real-time messaging during sessions.
- **Privacy Focused**: No video data is stored on a server; it's shared directly between users.
- **Built with**: React, Tailwind CSS, Motion, and PeerJS.

## How to Use

### Hosting a Session
1. Open the app and click **Select Video File**.
2. Choose a video from your local system.
3. Your **Room ID** will be displayed in the header. Share this with your friends.
4. Once friends join, they will see your video stream.

### Joining a Session
1. Get the **Room ID** from the host.
2. Paste the ID into the "Join a Session" box and click **Join Room**.
3. The video will start playing automatically when transmitted by the host.

## Development

This app is built with a custom Express + Vite server to support server-side rendering and API proxying if needed.

### Local Setup
1. `npm install`
2. `npm run dev`

### Building for Production
1. `npm run build`
2. `npm start`

## Technologies
- **PeerJS**: For P2P data and media connections.
- **React**: Frontend framework.
- **Tailwind CSS**: Styling.
- **Express**: Server environment.
