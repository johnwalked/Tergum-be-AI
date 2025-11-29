import React, { useState } from 'react';
import { GlassCard, NeonButton } from './GlassCard';
import { Play, Download, Type, Volume2, Mic } from 'lucide-react';
import { generateSpeechTTS } from '../services/geminiService';

export const TTSGenerator: React.FC = () => {
    const [text, setText] = useState('');
    const [voice, setVoice] = useState('Kore');
    const [isGenerating, setIsGenerating] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);

    const handleGenerate = async () => {
        if (!text) return;
        setIsGenerating(true);
        try {
            // generateSpeechTTS now returns a valid WAV Blob
            const blob = await generateSpeechTTS(text, voice);
            if (blob) {
                if (audioUrl) URL.revokeObjectURL(audioUrl);
                setAudioUrl(URL.createObjectURL(blob));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = () => {
        if (!audioUrl) return;
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = `nebula-tts-${voice}-${Date.now()}.wav`;
        a.click();
    };

    const voices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Titus', 'Keres', 'Iris', 'Lyra'];

    return (
        <div className="w-full h-full flex flex-col items-center justify-center p-4">
            <GlassCard className="w-full max-w-4xl p-8 space-y-8 bg-black/60 shadow-2xl">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-500/20 rounded-2xl text-blue-400 border border-blue-500/30">
                            <Type className="w-6 h-6" />
                        </div>
                        <h2 className="text-3xl font-bold font-ethiopic text-white">Speech Synthesis Studio</h2>
                    </div>
                    <p className="text-gray-400 pl-14">Transform text into lifelike audio using Gemini 2.5 Flash TTS.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Controls Column */}
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                                <Mic className="w-4 h-4 text-blue-400"/> Voice Persona
                            </label>
                            <div className="grid grid-cols-2 gap-2 h-48 overflow-y-auto scrollbar-hide pr-2">
                                {voices.map((v) => (
                                    <button
                                        key={v}
                                        onClick={() => setVoice(v)}
                                        className={`
                                            py-2 px-3 rounded-xl border transition-all text-sm font-medium text-left
                                            ${voice === v 
                                                ? 'bg-blue-500/20 border-blue-500 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
                                                : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                            }
                                        `}
                                    >
                                        {v}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Input Column */}
                    <div className="lg:col-span-2 space-y-4 flex flex-col">
                        <label className="text-sm font-medium text-gray-300">Input Text</label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Enter the text you want to convert to speech..."
                            className="flex-1 min-h-[200px] w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white placeholder-gray-600 focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none font-mono text-sm leading-relaxed"
                        />
                        
                        <div className="flex justify-between items-center pt-2 bg-black/20 p-4 rounded-2xl border border-white/5">
                            <div className="flex items-center gap-4">
                                {audioUrl && (
                                    <audio src={audioUrl} controls className="h-8 w-64 opacity-80 hover:opacity-100 transition-opacity" />
                                )}
                            </div>
                            <div className="flex gap-3">
                                {audioUrl && (
                                    <button onClick={handleDownload} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-all border border-white/10">
                                        <Download className="w-5 h-5"/>
                                    </button>
                                )}
                                <NeonButton onClick={handleGenerate} disabled={!text || isGenerating} className="min-w-[160px]">
                                    {isGenerating ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                                            Synthesizing...
                                        </>
                                    ) : (
                                        <>
                                            <Volume2 className="w-5 h-5" />
                                            Generate
                                        </>
                                    )}
                                </NeonButton>
                            </div>
                        </div>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
};