import React, { useState } from 'react';
import { GlassCard, NeonButton } from './GlassCard';
import { Play, Download, Type } from 'lucide-react';
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
                setAudioUrl(URL.createObjectURL(blob));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsGenerating(false);
        }
    };

    const voices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr', 'Titus', 'Keres', 'Iris', 'Lyra'];

    return (
        <div className="max-w-3xl mx-auto h-full flex flex-col justify-center">
            <GlassCard className="p-8 space-y-6">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 bg-green-500/20 rounded-xl text-green-400">
                        <Type className="w-6 h-6" />
                    </div>
                    <h2 className="text-2xl font-bold">Speech Synthesis Studio</h2>
                </div>

                <div className="space-y-4">
                    <label className="block text-sm font-medium text-gray-400">Voice Persona</label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                        {voices.map((v) => (
                            <button
                                key={v}
                                onClick={() => setVoice(v)}
                                className={`
                                    py-3 px-4 rounded-lg border transition-all text-sm
                                    ${voice === v 
                                        ? 'bg-green-500/20 border-green-500 text-green-300' 
                                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                                    }
                                `}
                            >
                                {v}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-400">Input Text</label>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter text to generate speech..."
                        className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-4 text-white placeholder-gray-600 focus:ring-1 focus:ring-green-500 focus:outline-none resize-none"
                    />
                </div>

                <div className="flex justify-end pt-4 gap-4">
                    {audioUrl && (
                        <audio src={audioUrl} controls className="h-12" />
                    )}
                    <NeonButton onClick={handleGenerate} disabled={!text || isGenerating} variant="secondary">
                        {isGenerating ? 'Synthesizing...' : 'Generate Audio'}
                    </NeonButton>
                </div>
            </GlassCard>
        </div>
    );
};