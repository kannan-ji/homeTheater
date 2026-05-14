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

## Deployment

### GitHub Pages
This repository includes a GitHub Action to deploy the app automatically.
1. Push this code to a GitHub repository.
2. Go to **Settings > Pages**.
3. Under **Build and deployment > Source**, ensure it is set to **GitHub Actions**.
4. The app will be available at `https://<username>.github.io/<repo-name>/`.

**Note:** If you are deploying to a subfolder (standard for GitHub Pages), you may need to update the `base` property in `vite.config.ts` to match your repository name (e.g., `base: '/homeTheater/'`).

### Local Setup
1. `npm install`
2. `npm run dev`

### Building for Production
1. `npm run build`
2. `npm start`

## Technologies & Architecture

### Core Stack
- **React 19**: Utilizing the latest concurrent features for a smooth UI.
- **Express**: Server-side API and infrastructure management.
- **Tailwind CSS 4**: Modern utility-first styling with high performance.
- **Vite 6**: Extremely fast development and build pipeline.
- **Motion**: Fluid animations for route transitions and interactive UI elements.
- **TypeScript**: Full type safety across the networking and UI layers.

### Networking (The "Swarm")
The heart of **homeTheater** is a custom P2P swarm architecture built on **PeerJS**:
- **MediaStream Tree**: To avoid overloading the host's upload bandwidth, the app uses a "streaming tree" approach. Peers who receive a stream can automatically forward it to others, creating a decentralized distribution network.
- **Synchronized State**: Playback commands (play, pause, seek) are broadcasted across the swarm using reliable data channels.
- **Presence Tracking**: Automatic management of peer entries and exits within the room.
