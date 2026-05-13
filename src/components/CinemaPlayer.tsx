import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, User, Users, Share2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CinemaPlayerProps {
  src?: string;
  stream?: MediaStream;
  onStreamCreated?: (stream: MediaStream) => void;
  onPlaybackBlocked?: () => void;
  onSync?: (state: { currentTime: number; paused: boolean; duration: number }) => void;
  syncState?: { currentTime: number; paused: boolean; duration: number };
  isHost?: boolean;
}

export default function CinemaPlayer({ 
  src, 
  stream, 
  onStreamCreated, 
  onPlaybackBlocked,
  onSync,
  syncState,
  isHost 
}: CinemaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(!isHost);
  const [showControls, setShowControls] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);

  // Sync volume and muted state to the video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);
  const controlsTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (videoRef.current && src) {
      // Very important: don't re-set src if it's already the same URL
      // This prevents the video from restarting when the host component re-renders
      const currentSrc = videoRef.current.src;
      if (currentSrc && (currentSrc.includes(src) || videoRef.current.currentSrc.includes(src))) {
        // Skip re-setting src
      } else {
        videoRef.current.src = src;
      }
      
      // When the host starts playing a local file, capture the stream
      if (isHost && onStreamCreated) {
        const video = videoRef.current;
        
        const tryCapture = () => {
          let capture: MediaStream | null = null;
          // @ts-ignore
          if (video.captureStream) {
            // @ts-ignore
            capture = video.captureStream(30); // 30fps hint
          } else if (video.mozCaptureStream) {
            // @ts-ignore
            capture = video.mozCaptureStream(30);
          }
          
          if (capture && capture.getVideoTracks().length > 0) {
            console.log('Stream captured successfully');
            onStreamCreated(capture);
            return true;
          }
          return false;
        };

        // Attempt capture on play or when metadata is loaded
        const handleCapture = () => {
          if (!tryCapture()) {
            // If it failed (often because video hasn't actually started drawing), 
            // retry once on the next frame or after a short delay
            setTimeout(tryCapture, 500);
          }
        };

        video.addEventListener('play', handleCapture);
        video.addEventListener('loadedmetadata', handleCapture);
        
        return () => {
          video.removeEventListener('play', handleCapture);
          video.removeEventListener('loadedmetadata', handleCapture);
        };
      }
    }
  }, [src, isHost, onStreamCreated]);

  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject === stream) return;
      
      const video = videoRef.current;
      console.log('Attaching stream to video element. ID:', stream.id, 'Tracks:', stream.getTracks().length);
      
      // Crucial: clear standard src when attaching srcObject, else some browsers get confused
      if (video.src) {
        video.src = "";
        video.removeAttribute('src');
      }

      // Explicitly set these via JS for maximum peer compatibility, because React props can sometimes miss the timing
      if (!isHost) {
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.autoplay = true;
      }

      // Monitor tracks
      stream.getTracks().forEach(track => {
        track.enabled = true; // force enable
        console.log(`Track: ${track.kind} - ${track.label} (${track.readyState})`);
        track.onunmute = () => {
          console.log(`Track unmuted: ${track.kind} - ${track.label}`);
          video.play().catch(e => console.warn('Play interrupted after unmute:', e.name));
        };
      });

      // Some browsers need a slight nudge or unmuted state to start a MediaStream
      video.srcObject = stream;
      
      // Force play explicitly just in case events don't fire
      video.play().catch(e => console.warn('Direct play failed:', e));
      
      const handleStreamReady = () => {
        console.log('Stream ready event triggered. Video tracks:', stream.getVideoTracks().map(t => `${t.label} (${t.readyState})`));
        video.play().catch(err => {
          console.warn('Initial stream playback failed (normal):', err.name);
          setIsBlocked(true);
          if (!isHost && onPlaybackBlocked) onPlaybackBlocked();
        });
      };

      video.addEventListener('loadedmetadata', handleStreamReady);
      video.addEventListener('canplay', handleStreamReady);
      return () => {
        video.removeEventListener('loadedmetadata', handleStreamReady);
        video.removeEventListener('canplay', handleStreamReady);
      };
    }
  }, [stream, isHost, onPlaybackBlocked]);

  // Sync state from host to peer
  useEffect(() => {
    if (!isHost && syncState && videoRef.current) {
      const video = videoRef.current;
      
      const applySync = () => {
        if (video.readyState >= 1) {
          // Play/Pause sync
          if (syncState.paused !== video.paused) {
            if (syncState.paused) {
              video.pause();
            } else {
              video.play().catch(() => {
                if (onPlaybackBlocked) onPlaybackBlocked();
              });
            }
          }
        }
      };

      if (video.readyState >= 1) {
        applySync();
      } else {
        video.addEventListener('loadedmetadata', applySync);
        video.addEventListener('canplay', applySync);
      }

      return () => {
        video.removeEventListener('loadedmetadata', applySync);
        video.removeEventListener('canplay', applySync);
      };
    }
  }, [syncState, isHost, onPlaybackBlocked]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    emitSync();
  };

  const lastSyncSecond = useRef<number>(-1);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const duration = videoRef.current.duration || 1;
    setProgress((current / duration) * 100);
    
    // Host reports sync every second change to stay tight without flooding
    const currentSecond = Math.floor(current);
    if (isHost && currentSecond !== lastSyncSecond.current) {
      lastSyncSecond.current = currentSecond;
      emitSync();
    }
  };

  const emitSync = () => {
    if (isHost && onSync && videoRef.current) {
      onSync({
        currentTime: videoRef.current.currentTime,
        paused: videoRef.current.paused,
        duration: videoRef.current.duration || 1
      });
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current || !isHost) return;
    const newProgress = parseFloat(e.target.value);
    const duration = videoRef.current.duration || 0;
    const newTime = (newProgress / 100) * duration;
    videoRef.current.currentTime = newTime;
    setProgress(newProgress);
    emitSync();
  };

  const toggleFullScreen = () => {
    if (videoRef.current?.parentElement) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.parentElement.requestFullscreen();
      }
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = window.setTimeout(() => setShowControls(false), 3000);
  };

  return (
    <div 
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl group border border-white/5"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setShowControls(false)}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          setIsPlaying(true);
          setIsBlocked(false);
        }}
        onPause={() => setIsPlaying(false)}
        autoPlay={true}
        muted={isMuted} // Controlled by our explicit state
        playsInline
      />

      <AnimatePresence>
        {isBlocked && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center cursor-pointer"
            onClick={() => {
               if (videoRef.current) {
                 videoRef.current.muted = true;
                 setIsMuted(true);
                 videoRef.current.play().catch(e => console.warn('Still blocked:', e));
                 setIsBlocked(false);
               } 
            }}
          >
            <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(220,38,38,0.4)] mb-4">
              <Play size={36} fill="currentColor" className="ml-2 text-white" />
            </div>
            <p className="text-white font-bold text-lg">Click to join stream</p>
            <p className="text-gray-400 text-sm mt-2">Browser autoplay policy requires interaction</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 flex flex-col justify-end p-4 md:p-6"
          >
            {/* Progress Bar */}
            <div className="w-full mb-4 px-2">
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={isHost ? progress : (syncState ? (syncState.currentTime / (syncState.duration || 1)) * 100 : 0)}
                onChange={handleProgressChange}
                disabled={!isHost}
                className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-red-500 hover:h-2 transition-all"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button 
                  onClick={togglePlay}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-white"
                  disabled={!isHost}
                >
                  {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                </button>

                <div className="flex items-center gap-2 group/volume">
                  <button 
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors text-white"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-0 overflow-hidden group-hover/volume:w-24 transition-all h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>
                
                <span className="text-white/60 text-sm font-mono">
                  {isHost 
                    ? `${videoRef.current ? formatTime(videoRef.current.currentTime) : '0:00'} / ${videoRef.current ? formatTime(videoRef.current.duration) : '0:00'}`
                    : `${syncState ? formatTime(syncState.currentTime) : '0:00'} / ${syncState ? formatTime(syncState.duration) : '0:00'}`
                  }
                </span>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  onClick={toggleFullScreen}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-white"
                >
                  <Maximize size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!src && !stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-white/50 text-center px-4">
          <Play size={48} className="mb-4 opacity-20" />
          <p className="text-lg font-medium text-white/80">No Video Source</p>
          <p className="text-sm">Wait for host to stream or select a file</p>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  if (isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? h + ':' : ''}${m}:${s.toString().padStart(2, '0')}`;
}
