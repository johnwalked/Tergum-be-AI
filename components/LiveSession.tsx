import React, { useState, useEffect, useRef } from 'react';
import { GlassCard, NeonButton } from './GlassCard';
import { Mic, MicOff, Activity, MessageSquare } from 'lucide-react';
import { createLiveSession } from '../services/geminiService';

export const LiveSession: React.FC = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [transcripts, setTranscripts] = useState<{text: string, isUser: boolean}[]>([]);
    const [error, setError] = useState<string | null>(null);
    const stopSessionRef = useRef<() => void>();
    
    // Audio context for playback
    const audioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef<number>(0);

    useEffect(() => {
        // Initialize AudioContext
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
            sampleRate: 24000
        });
        return () => {
            stopSessionRef.current?.();
            audioContextRef.current?.close();
        }
    }, []);

    const toggleSession = async () => {
        if (isConnected) {
            stopSessionRef.current?.();
            setIsConnected(false);
            setTranscripts(prev => [...prev, { text: "Session ended.", isUser: false }]);
        } else {
            setError(null);
            try {
                const session = await createLiveSession(
                    // onAudioData
                    async (buffer) => {
                        const ctx = audioContextRef.current;
                        if (!ctx) return;
                        
                        const int16 = new Int16Array(buffer);
                        const float32 = new Float32Array(int16.length);
                        for(let i=0; i<int16.length; i++) {
                            float32[i] = int16[i] / 32768.0;
                        }
                        
                        const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
                        audioBuffer.getChannelData(0).set(float32);
                        
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(ctx.destination);
                        
                        const now = ctx.currentTime;
                        const start = Math.max(now, nextStartTimeRef.current);
                        source.start(start);
                        nextStartTimeRef.current = start + audioBuffer.duration;
                    },
                    // onTranscription
                    (text, isUser) => {
                        setTranscripts(prev => {
                            const last = prev[prev.length - 1];
                            // Append to last message if same speaker to handle streaming chunks
                            if (last && last.isUser === isUser) {
                                return [...prev.slice(0, -1), { text: last.text + text, isUser }];
                            }
                            return [...prev, { text, isUser }];
                        });
                    },
                    // onClose
                    () => setIsConnected(false)
                );
                
                stopSessionRef.current = session.close;
                setIsConnected(true);
            } catch (err: any) {
                setError("Failed to connect: " + err.message);
            }
        }
    };

    return (
        <div className="h-full flex flex-col gap-6 max-w-4xl mx-auto">
            <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                    Live Conversational AI
                </h2>
                <p className="text-gray-400">
                    Talk directly with Gemini 2.5 using the Live API. Real-time low-latency voice interaction.
                </p>
            </div>

            <GlassCard className="flex-1 flex flex-col relative overflow-hidden">
                {/* Visualizer / Status Area */}
                <div className="absolute inset-0 flex items-center justify-center opacity-10 pointer-events-none">
                    <Activity className={`w-96 h-96 ${isConnected ? 'animate-pulse text-blue-500' : 'text-gray-600'}`} />
                </div>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 z-10">
                    {transcripts.length === 0 && (
                        <div className="h-full flex items-center justify-center text-gray-500">
                            Start the session and say "Hello"
                        </div>
                    )}
                    {transcripts.map((t, i) => (
                        <div key={i} className={`flex ${t.isUser ? 'justify-end' : 'justify-start'}`}>
                            <div className={`
                                max-w-[80%] p-4 rounded-2xl backdrop-blur-md border
                                ${t.isUser 
                                    ? 'bg-blue-500/10 border-blue-500/20 text-blue-100 rounded-br-none' 
                                    : 'bg-purple-500/10 border-purple-500/20 text-purple-100 rounded-bl-none'
                                }
                            `}>
                                {t.text}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Controls */}
                <div className="p-6 border-t border-white/10 z-20 flex justify-center gap-4 bg-black/20 backdrop-blur-lg">
                    {error && <div className="absolute top-4 left-0 right-0 text-center text-red-400 text-sm">{error}</div>}
                    
                    <NeonButton 
                        variant={isConnected ? 'danger' : 'primary'}
                        onClick={toggleSession}
                        className="w-48"
                    >
                        {isConnected ? (
                            <>
                                <MicOff className="w-5 h-5" />
                                End Session
                            </>
                        ) : (
                            <>
                                <Mic className="w-5 h-5" />
                                Start Live Chat
                            </>
                        )}
                    </NeonButton>
                </div>
            </GlassCard>
        </div>
    );
};
