import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GlassCard } from './GlassCard';
import { Upload, Play, Pause, Volume2, Settings, Scissors, Sparkles, RefreshCw, AlertTriangle, Download, Edit2, Save, X, Mic, UserPlus, WifiOff, Clock, User, Zap } from 'lucide-react';
import { analyzeVideoForDubbing, translateAndRefineScript, generateSpeechTTS, audioBufferToWav, analyzeVoiceSample, checkApiConnection } from '../services/geminiService';
import { ProcessingStatus, VideoAnalysisResult, SpeakerAnalysis, DubbingSegment, ClonedVoice } from '../types';

interface AudioData { url: string; duration: number; }
interface SubtitleSettings { size: number; opacity: number; bottom: number; }

const UI_TEXT = {
    am: {
        uploadTitle: "ቪዲዮ ይስቀሉ", uploadDesc: "ከፍተኛ 50ሜባ • MP4/MOV",
        ready: "ዝግጁ", analyzing: "ቪዲዮውን በመተንተን ላይ...", generating: "ድምጽ በማመንጨት ላይ...", complete: "ተጠናቀቀ", error: "ስህተት",
        subtitleSettings: "የግርጌ ጽሑፍ", size: "መጠን", opacity: "ግልጽነት", position: "ቦታ",
        save: "አስቀምጥ", dub: "አቀናብር", exporting: "በመላክ ላይ...", cloneVoice: "ድምጽ ቅዳ", voiceStudio: "የድምጽ ስቱዲዮ",
        retry: "እንደገና", cancel: "ተው", confirmSplit: "ከፋፍል", failedSegment: "መክሸፍ", failedReason: "ምክንያት",
        connectionLost: "የበይነመረብ ግንኙነት ጠፍቷል", checkKey: "ኤፒአይ ቁልፍን ያረጋግጡ",
        retryAll: "ሁሉንም እንደገና ይሞክሩ", translating: "ስክሪፕት በመተርጎም ላይ...",
        estTime: "የቀረው ጊዜ", sec: "ሰከንድ"
    },
    en: {
        uploadTitle: "UPLOAD VIDEO", uploadDesc: "Max 50MB • MP4/MOV",
        ready: "READY", analyzing: "Analyzing Video & Detecting Speakers...", generating: "Generating Dubbed Audio...", complete: "COMPLETE", error: "ERROR",
        subtitleSettings: "Subtitles", size: "Size", opacity: "Opacity", position: "Position",
        save: "Save", dub: "Dub", exporting: "Exporting...", cloneVoice: "Clone Voice", voiceStudio: "Voice Studio",
        retry: "Retry", cancel: "Cancel", confirmSplit: "Split", failedSegment: "Failed", failedReason: "Reason",
        connectionLost: "API Connection Failed", checkKey: "Check API Key",
        retryAll: "Retry All Failed", translating: "Translating Script...",
        estTime: "Est. Time", sec: "s"
    }
};

export const VideoDubber: React.FC<{ interfaceLang?: 'am' | 'en' }> = ({ interfaceLang = 'am' }) => {
  const t = UI_TEXT[interfaceLang];

  // State
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [detailedStatus, setDetailedStatus] = useState<string>("");
  const [analysis, setAnalysis] = useState<VideoAnalysisResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [dubbedAudioData, setDubbedAudioData] = useState<Record<string, AudioData>>({});
  const [segmentStatuses, setSegmentStatuses] = useState<Record<string, 'pending'|'generating'|'complete'|'error'>>({});
  const [segmentErrors, setSegmentErrors] = useState<Record<string, string>>({}); 
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState<boolean>(true);
  
  // Progress State
  const [progress, setProgress] = useState(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  
  // Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [originalVolume, setOriginalVolume] = useState(0.2); 
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  
  // UI State
  const [subSettings, setSubSettings] = useState<SubtitleSettings>({ size: 16, opacity: 0.6, bottom: 10 });
  const [showSubSettings, setShowSubSettings] = useState(false);
  const [showVoiceStudio, setShowVoiceStudio] = useState(false);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [segmentToSplit, setSegmentToSplit] = useState<DubbingSegment | null>(null);
  const [splitTexts, setSplitTexts] = useState({ left: '', right: '' });
  const [isEditingTimings, setIsEditingTimings] = useState(false);
  const [tempSegments, setTempSegments] = useState<DubbingSegment[]>([]);

  // Refs for Engine (Avoid stale closures)
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeSegmentRef = useRef<DubbingSegment | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const segmentCursorRef = useRef<number>(0);
  const analysisRef = useRef<VideoAnalysisResult | null>(null);
  const dubbedAudioDataRef = useRef(dubbedAudioData);

  // Sync Refs with State
  useEffect(() => { analysisRef.current = analysis; }, [analysis]);
  useEffect(() => { dubbedAudioDataRef.current = dubbedAudioData; }, [dubbedAudioData]);
  
  // AudioContext Refs
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  // Track all running sources to allow overlaps (crossfades) and cleanup
  const runningSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Initial API Check
  useEffect(() => {
      checkApiConnection().then(setApiConnected);
  }, []);

  // Initialize Audio Context on user interaction
  const initAudioContext = () => {
    if (!playbackCtxRef.current) {
        const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
        playbackCtxRef.current = new AudioCtor(); // Use native sample rate for better quality
        const gain = playbackCtxRef.current.createGain();
        gain.connect(playbackCtxRef.current.destination);
        gainNodeRef.current = gain;
    }
    if (playbackCtxRef.current.state === 'suspended') {
        playbackCtxRef.current.resume();
    }
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (!videoRef.current) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (videoRef.current.paused) { initAudioContext(); videoRef.current.play(); }
                else videoRef.current.pause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
                setCurrentTime(videoRef.current.currentTime);
                stopAllAudio();
                break;
            case 'ArrowRight':
                e.preventDefault();
                videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
                setCurrentTime(videoRef.current.currentTime);
                stopAllAudio();
                break;
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      Object.values(dubbedAudioDataRef.current).forEach((d: any) => {
          if (d?.url) URL.revokeObjectURL(d.url);
      });
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      stopAllAudio();
      playbackCtxRef.current?.close();
    };
  }, []); 

  const stopAllAudio = () => {
      // Fade out all currently running sources
      runningSourcesRef.current.forEach(source => {
          try {
              source.stop();
          } catch(e){}
      });
      runningSourcesRef.current.clear();
      activeSegmentRef.current = null;
      if (videoRef.current) videoRef.current.volume = originalVolume;
  };

  const resetState = () => {
      setAnalysis(null); setDubbedAudioData({}); setSegmentStatuses({}); setSegmentErrors({});
      setStatus(ProcessingStatus.IDLE); setCurrentTime(0); setIsPlaying(false);
      activeSegmentRef.current = null; segmentCursorRef.current = 0;
      setProgress(0); setEstimatedSeconds(null);
      stopAllAudio();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    resetState();
  };

  const generateSegmentAudio = async (segment: DubbingSegment, speakers: SpeakerAnalysis[]) => {
      const id = segment.id;
      setSegmentStatuses(p => ({ ...p, [id]: 'generating' }));
      setSegmentErrors(p => { const n = {...p}; delete n[id]; return n; }); 

      try {
          const spk = speakers.find(s => s.id === segment.speakerId) || { id: 'uk', gender: 'Female', voiceQuality: 'Mid', assignedVoice: 'Kore' };
          const voiceToUse = spk.assignedVoice || 'Kore';
          
          const blob = await generateSpeechTTS(segment.translatedText || segment.originalText, voiceToUse);
          if (blob) {
              const url = URL.createObjectURL(blob);
              setDubbedAudioData(p => ({ ...p, [id]: { url, duration: 0 } }));
              setSegmentStatuses(p => ({ ...p, [id]: 'complete' }));
          } else {
              setSegmentStatuses(p => ({ ...p, [id]: 'complete' })); // Silent fallback handled in service
          }
      } catch (error: any) {
          console.error(`Audio generation failed for ${id}:`, error);
          setSegmentStatuses(p => ({ ...p, [id]: 'error' }));
          setSegmentErrors(p => ({ ...p, [id]: error.message || "Unknown error" }));
      }
  };

  const retryFailedSegments = async () => {
      if (!analysis) return;
      const failed = analysis.segments.filter(s => segmentStatuses[s.id] === 'error');
      const batchSize = 2;
      for (let i = 0; i < failed.length; i += batchSize) {
          await Promise.all(failed.slice(i, i + batchSize).map(s => generateSegmentAudio(s, analysis.speakers || [])));
      }
  };

  const processVideo = async () => {
    if (!videoFile) return;
    initAudioContext();
    if (!apiConnected) {
        const check = await checkApiConnection();
        setApiConnected(check);
        if (!check) { setErrorMessage(t.connectionLost); return; }
    }

    try {
      // 1. Analysis
      setStatus(ProcessingStatus.ANALYZING);
      setDetailedStatus(t.analyzing);
      setProgress(10);
      
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        
        // Simulating analysis progress since it's one big call
        const progressInterval = setInterval(() => {
            setProgress(prev => Math.min(prev + 1, 35));
        }, 500);

        const analysisRes = await analyzeVideoForDubbing(base64, videoFile.type);
        clearInterval(progressInterval);
        
        setAnalysis(analysisRes);
        setProgress(40);
        
        // 2. Translation (Context Aware)
        setDetailedStatus(t.translating);
        const translatedSegments = await translateAndRefineScript(analysisRes.segments, "Amharic", analysisRes.summary || "No summary");
        setAnalysis({ ...analysisRes, segments: translatedSegments });
        setProgress(50);
        
        // 3. Generation
        setStatus(ProcessingStatus.GENERATING);
        setDetailedStatus(t.generating);
        
        const totalSegs = translatedSegments.length;
        const batchSize = 2;
        const avgTimePerBatch = 3; // Estimated seconds
        
        for (let i = 0; i < totalSegs; i += batchSize) {
            const batch = translatedSegments.slice(i, i + batchSize);
            const remainingBatches = Math.ceil((totalSegs - i) / batchSize);
            setEstimatedSeconds(remainingBatches * avgTimePerBatch);
            
            await Promise.all(batch.map((s: any) => generateSegmentAudio(s, analysisRes.speakers || [])));
            
            const currentProgress = 50 + (((i + batch.length) / totalSegs) * 50);
            setProgress(currentProgress);
        }
        
        setProgress(100);
        setEstimatedSeconds(0);
        setStatus(ProcessingStatus.COMPLETE);
        setDetailedStatus(t.complete);
      };
      reader.readAsDataURL(videoFile);
    } catch (e: any) { setErrorMessage(e.message); setStatus(ProcessingStatus.ERROR); }
  };

  // --- Sync Engine ---
  const syncLoop = useCallback(() => {
      if (!videoRef.current) return;
      const vTime = videoRef.current.currentTime;
      setCurrentTime(vTime);

      // Use Ref to avoid stale closure if analysis changes
      const segments = analysisRef.current?.segments;
      if (!segments) return;

      // 1. VISUAL SYNC: Determine Active Segment (Works even when paused)
      if (segmentCursorRef.current >= segments.length || segments[segmentCursorRef.current].startTime > vTime + 0.5) {
          let found = false;
          for(let i=0; i<segments.length; i++) {
              if (vTime >= segments[i].startTime && vTime <= segments[i].endTime) {
                  segmentCursorRef.current = i;
                  found = true;
                  break;
              }
              if (segments[i].startTime > vTime) {
                   segmentCursorRef.current = i; 
                   break;
              }
          }
          if (!found) segmentCursorRef.current = 0;
      }
      
      // Fast forward cursor if we passed segments
      while (segmentCursorRef.current < segments.length && segments[segmentCursorRef.current].endTime < vTime) {
          segmentCursorRef.current++;
      }
      
      const currentSeg = segments[segmentCursorRef.current];
      const inSegment = currentSeg && vTime >= currentSeg.startTime && vTime <= currentSeg.endTime;
      
      const nextActiveId = inSegment ? currentSeg.id : null;
      setActiveSegmentId(prev => prev !== nextActiveId ? nextActiveId : prev);

      // 2. AUDIO PLAYBACK (Only when playing)
      if (isPlaying) {
          if (inSegment && activeSegmentRef.current?.id !== currentSeg.id) {
              // New Segment Detected - Play It!
              // Note: We DO NOT stop previous audio here, allowing crossfade/overlap
              activeSegmentRef.current = currentSeg;
              
              const audioData = dubbedAudioDataRef.current[currentSeg.id];
              const ctx = playbackCtxRef.current;
              
              if (audioData && ctx && gainNodeRef.current) {
                  fetch(audioData.url)
                    .then(r => r.arrayBuffer())
                    .then(buf => ctx.decodeAudioData(buf))
                    .then(decodedBuffer => {
                        // Safety check: if user paused or seeked while decoding
                        if (videoRef.current?.paused) return;
                        
                        const source = ctx.createBufferSource();
                        source.buffer = decodedBuffer;
                        
                        const slotDur = currentSeg.endTime - currentSeg.startTime;
                        let rate = decodedBuffer.duration / slotDur;
                        
                        // --- FIX PITCH / CHIPMUNK ISSUE ---
                        // Instead of forcing the audio to fit by speeding it up significantly (which raises pitch),
                        // we strictly cap the playback rate to 1.1x.
                        // If the audio is longer, it will naturally OVERLAP into the next segment or silence.
                        // This maintains voice quality.
                        rate = Math.min(Math.max(rate, 0.9), 1.1);
                        
                        source.playbackRate.value = rate;
                        
                        const sourceGain = ctx.createGain();
                        source.connect(sourceGain);
                        sourceGain.connect(gainNodeRef.current!);

                        const currentVTime = videoRef.current?.currentTime || 0;
                        const offset = Math.max(0, (currentVTime - currentSeg.startTime) * rate);
                        
                        if (offset < decodedBuffer.duration) {
                            const now = ctx.currentTime;
                            sourceGain.gain.setValueAtTime(0, now);
                            sourceGain.gain.linearRampToValueAtTime(1, now + 0.05); // 50ms fade in
                            
                            const remainingPlayTime = (decodedBuffer.duration - offset) / rate;
                            sourceGain.gain.setValueAtTime(1, now + remainingPlayTime - 0.05);
                            sourceGain.gain.linearRampToValueAtTime(0, now + remainingPlayTime); // 50ms fade out

                            source.start(now, offset);
                            runningSourcesRef.current.add(source);
                            
                            // Ducking
                            if (videoRef.current) videoRef.current.volume = originalVolume * 0.05; 
                            
                            source.onended = () => {
                                runningSourcesRef.current.delete(source);
                                // Restore volume only if no other dubbed audio is playing
                                if (runningSourcesRef.current.size === 0 && videoRef.current) {
                                     videoRef.current.volume = originalVolume;
                                }
                            };
                        }
                    })
                    .catch(err => {
                         console.warn("Decode error for seg", currentSeg.id, err);
                         if (videoRef.current) videoRef.current.volume = originalVolume;
                    });
              }
          }
      }

      animationFrameRef.current = requestAnimationFrame(syncLoop);
  }, [isPlaying, originalVolume]);

  useEffect(() => {
      animationFrameRef.current = requestAnimationFrame(syncLoop);
      return () => { if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [syncLoop]);

  const handleExport = async () => {
      if (!analysis) return;
      setIsExporting(true);
      try {
          const exportDuration = Number.isFinite(duration) && duration > 0 ? duration : analysis.segments[analysis.segments.length-1].endTime + 2;
          const offlineCtx = new OfflineAudioContext(1, Math.ceil(exportDuration * 24000), 24000);
          
          for (const seg of analysis.segments) {
              const data = dubbedAudioData[seg.id];
              if (data) {
                  try {
                      const buf = await fetch(data.url).then(r => r.arrayBuffer()).then(b => offlineCtx.decodeAudioData(b));
                      const src = offlineCtx.createBufferSource();
                      src.buffer = buf;
                      const slotDur = seg.endTime - seg.startTime;
                      
                      // Apply same pitch constraints to export
                      let rate = buf.duration / slotDur;
                      // STRICT CAP 1.1x for quality export
                      rate = Math.min(Math.max(rate, 0.9), 1.1);
                      
                      src.playbackRate.value = rate;
                      
                      // Add fades to export as well
                      const gain = offlineCtx.createGain();
                      src.connect(gain);
                      gain.connect(offlineCtx.destination);
                      
                      gain.gain.setValueAtTime(0, seg.startTime);
                      gain.gain.linearRampToValueAtTime(1, seg.startTime + 0.05);
                      const dur = buf.duration / rate;
                      gain.gain.setValueAtTime(1, seg.startTime + dur - 0.05);
                      gain.gain.linearRampToValueAtTime(0, seg.startTime + dur);

                      src.start(seg.startTime);
                  } catch (err) {
                      console.warn(`Skipping segment ${seg.id} in export due to decode error:`, err);
                  }
              }
          }
          const rendered = await offlineCtx.startRendering();
          const url = URL.createObjectURL(audioBufferToWav(rendered));
          const a = document.createElement('a'); a.href = url; a.download = 'nebula_dub_export.wav'; a.click();
      } catch (e) {
          console.error("Export failed", e);
          setErrorMessage("Export Failed. Please try again.");
      }
      setIsExporting(false);
  };

  const handleVoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsAnalyzingVoice(true);
      const reader = new FileReader();
      reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const res = await analyzeVoiceSample(base64, file.type);
          let baseVoice = res.gender === 'Male' ? (res.voiceQuality === 'Deep' ? 'Fenrir' : 'Charon') : (res.voiceQuality === 'Soft' ? 'Zephyr' : 'Kore');
          setClonedVoices(p => [...p, { id: `c_${Date.now()}`, name: `Voice ${p.length+1} (${res.gender})`, baseVoice, gender: res.gender, characteristics: res.voiceQuality }]);
          setIsAnalyzingVoice(false); setShowVoiceStudio(false);
      };
      reader.readAsDataURL(file);
  };
  
  const hasErrors = Object.values(segmentStatuses).includes('error');

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-8rem)] gap-4 lg:gap-6 w-full pb-4">
       {/* Player */}
       <div className="flex-[2] flex flex-col gap-4 relative group min-h-[50vh]">
           <GlassCard className="relative w-full h-full overflow-hidden flex items-center justify-center bg-black shadow-2xl rounded-[2.5rem]">
             {!apiConnected && (
                 <div className="absolute top-4 left-4 z-50 bg-red-500/20 text-red-200 px-4 py-2 rounded-xl flex items-center gap-2 border border-red-500/30">
                     <WifiOff className="w-4 h-4"/> <span className="text-xs font-bold">{t.checkKey}</span>
                 </div>
             )}
             {videoUrl ? (
               <div className="relative w-full h-full bg-black flex items-center justify-center">
                 <video ref={videoRef} src={videoUrl} className="max-w-full max-h-full" onPlay={() => { initAudioContext(); setIsPlaying(true); }} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} onLoadedMetadata={e => setDuration(e.currentTarget.duration)} />
                 {/* Subtitles */}
                 {activeSegmentId && (
                    <div className="absolute w-full flex justify-center pointer-events-none z-20 transition-all" style={{ bottom: `${subSettings.bottom}%` }}>
                        <span className="font-ethiopic px-6 py-3 rounded-2xl backdrop-blur-xl border border-white/5 shadow-lg text-white text-center" style={{ fontSize: `${subSettings.size}px`, backgroundColor: `rgba(0,0,0,${subSettings.opacity})` }}>
                            {analysis?.segments.find(s => s.id === activeSegmentId)?.translatedText}
                        </span>
                    </div>
                 )}
                 {/* Progress Overlay during processing */}
                 {(status === ProcessingStatus.ANALYZING || status === ProcessingStatus.GENERATING) && (
                     <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 flex flex-col items-center justify-center">
                         <div className="w-64 space-y-4 text-center">
                             <div className="relative w-full h-2 bg-white/10 rounded-full overflow-hidden">
                                 <div className="absolute h-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300" style={{ width: `${progress}%` }} />
                             </div>
                             <div>
                                <h3 className="text-blue-300 font-bold font-ethiopic animate-pulse">{detailedStatus}</h3>
                                {estimatedSeconds !== null && estimatedSeconds > 0 && (
                                    <p className="text-xs text-gray-400 mt-1 font-mono">{t.estTime}: ~{estimatedSeconds}{t.sec}</p>
                                )}
                             </div>
                         </div>
                     </div>
                 )}
                 {/* Controls */}
                 <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl z-40 opacity-0 group-hover:opacity-100 transition-all translate-y-4 group-hover:translate-y-0">
                     <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-4 shadow-2xl">
                        {/* Enhanced Scrubber */}
                        <div 
                            className="relative h-3 bg-white/10 rounded-full mb-4 cursor-pointer group/scrubber flex items-center" 
                            onClick={e => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                                if (videoRef.current && Number.isFinite(duration) && duration > 0) { 
                                    videoRef.current.currentTime = pos * duration; 
                                    setCurrentTime(pos * duration); 
                                    stopAllAudio();
                                }
                        }}>
                            {/* Segments Markers */}
                            {analysis?.segments.map((seg) => {
                                if (!duration) return null;
                                const left = (seg.startTime / duration) * 100;
                                const width = Math.max(((seg.endTime - seg.startTime) / duration) * 100, 0.5); 
                                return (
                                    <div 
                                        key={seg.id}
                                        className={`absolute top-0 h-full transition-all z-0 border-l ${activeSegmentId === seg.id ? 'bg-green-500/40 border-green-400' : 'bg-blue-500/20 border-blue-400/50 hover:bg-blue-500/40'}`}
                                        style={{ left: `${left}%`, width: `${width}%` }}
                                        title={`${seg.startTime.toFixed(1)}s - ${seg.translatedText}`}
                                    />
                                );
                            })}
                            <div className="absolute h-full left-0 bg-blue-500/80 rounded-l-full z-10 pointer-events-none" style={{ width: `${(currentTime/duration)*100}%` }} />
                            <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)] scale-0 group-hover/scrubber:scale-100 transition-transform z-20 pointer-events-none" style={{ left: `calc(${(currentTime/duration)*100}% - 8px)` }}/>
                        </div>

                        <div className="flex justify-between items-center">
                             <button onClick={() => { if(videoRef.current) { if(isPlaying) videoRef.current.pause(); else { initAudioContext(); videoRef.current.play(); }}}} className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
                                 {isPlaying ? <Pause className="fill-white"/> : <Play className="fill-white ml-1"/>}
                             </button>
                             <div className="flex gap-4">
                                <div className="flex items-center gap-2 bg-white/5 rounded-full px-3 py-1">
                                    <Volume2 className="w-4 h-4 text-gray-400"/>
                                    <input type="range" min="0" max="1" step="0.1" value={originalVolume} onChange={e => { setOriginalVolume(parseFloat(e.target.value)); if (videoRef.current) videoRef.current.volume = parseFloat(e.target.value); }} className="w-20 h-1 bg-white/20 rounded-lg appearance-none"/>
                                </div>
                                <button onClick={() => setShowSubSettings(!showSubSettings)}><Settings className="w-5 h-5 text-gray-400 hover:text-white transition-colors"/></button>
                             </div>
                        </div>
                     </div>
                 </div>
                 {showSubSettings && (
                     <div className="absolute bottom-32 right-8 w-64 p-5 bg-black/80 backdrop-blur-2xl border border-white/10 rounded-3xl z-50 shadow-2xl">
                        <h4 className="text-white text-sm mb-4 font-ethiopic">{t.subtitleSettings}</h4>
                        <input type="range" min="12" max="36" value={subSettings.size} onChange={e => setSubSettings({...subSettings, size: Number(e.target.value)})} className="w-full mb-4 h-1 bg-white/10 rounded-full appearance-none"/>
                        <input type="range" min="0" max="1" step="0.1" value={subSettings.opacity} onChange={e => setSubSettings({...subSettings, opacity: Number(e.target.value)})} className="w-full mb-4 h-1 bg-white/10 rounded-full appearance-none"/>
                        <input type="range" min="5" max="50" value={subSettings.bottom} onChange={e => setSubSettings({...subSettings, bottom: Number(e.target.value)})} className="w-full h-1 bg-white/10 rounded-full appearance-none"/>
                     </div>
                 )}
               </div>
             ) : (
               <label className="flex flex-col items-center cursor-pointer group/upload">
                  <div className="w-24 h-24 rounded-[2rem] bg-black/40 border border-white/10 flex items-center justify-center shadow-2xl group-hover/upload:border-blue-500/50 transition-all">
                     <Upload className="w-10 h-10 text-blue-200" />
                  </div>
                  <span className="mt-4 text-2xl font-light tracking-widest text-white font-ethiopic">{t.uploadTitle}</span>
                  <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
               </label>
             )}
           </GlassCard>

           {/* Action Orb */}
           {(status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETE) && videoFile && (
                <button onClick={status === ProcessingStatus.COMPLETE ? handleExport : processVideo} disabled={isExporting} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full flex items-center justify-center hover:scale-110 transition-transform duration-500 z-50">
                    <div className="absolute inset-0 bg-blue-500/20 blur-3xl animate-pulse rounded-full" />
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black border border-white/10 backdrop-blur-xl shadow-inner rounded-full" />
                    <div className="relative z-10 flex flex-col items-center text-blue-100">
                        {isExporting ? <RefreshCw className="animate-spin"/> : status === ProcessingStatus.IDLE ? <Sparkles/> : <Download/>}
                        <span className="text-[10px] tracking-widest font-bold uppercase font-ethiopic mt-1">{isExporting ? t.exporting : status === ProcessingStatus.IDLE ? t.dub : t.save}</span>
                    </div>
                </button>
           )}
           
           {/* Voice Button */}
           {status !== ProcessingStatus.ANALYZING && status !== ProcessingStatus.GENERATING && videoFile && (
             <button onClick={() => setShowVoiceStudio(true)} className="absolute bottom-6 right-6 p-4 rounded-full bg-black/60 border border-white/10 backdrop-blur-xl hover:bg-white/10 transition-all z-50"><Mic className="w-6 h-6 text-white"/></button>
           )}
       </div>

       {/* Script Panel */}
       <div className="flex-1 lg:max-w-md flex flex-col gap-4 min-h-[40vh]">
           <GlassCard className="flex-1 flex flex-col bg-black/20 border-white/5 rounded-[2rem] overflow-hidden">
              <div className="p-6 border-b border-white/5 flex flex-col gap-2 bg-white/[0.02]">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-white font-ethiopic">{t.dubbingScript}</h3>
                    <div className="flex gap-2">
                        {hasErrors && (
                            <button onClick={retryFailedSegments} className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2">
                                <RefreshCw className="w-3 h-3"/> {t.retryAll}
                            </button>
                        )}
                        {status === ProcessingStatus.COMPLETE && (
                            <button onClick={() => { if(isEditingTimings) setAnalysis(p => p ? ({...p, segments: tempSegments}) : null); setIsEditingTimings(!isEditingTimings); if(!isEditingTimings) setTempSegments(analysis?.segments || []); }} className="p-2 hover:bg-white/10 rounded-lg transition-all">
                                {isEditingTimings ? <Save className="w-4 h-4 text-blue-400"/> : <Edit2 className="w-4 h-4 text-gray-400"/>}
                            </button>
                        )}
                    </div>
                  </div>
                  {/* Speakers Legend */}
                  {analysis?.speakers && (
                      <div className="flex flex-wrap gap-2 mt-2">
                          {analysis.speakers.map(spk => (
                              <div key={spk.id} className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-2" title={`${spk.ageRange} ${spk.gender}, ${spk.voiceQuality}`}>
                                  <User className="w-3 h-3 text-blue-400"/>
                                  <span className="text-gray-300 font-bold">{spk.id}</span>
                                  <span className="text-gray-500">→</span>
                                  <span className="text-blue-300">{spk.assignedVoice}</span>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                  {(isEditingTimings ? tempSegments : analysis?.segments)?.map((seg, idx) => {
                      const spk = analysis?.speakers.find(s => s.id === seg.speakerId);
                      const hasAudio = !!dubbedAudioData[seg.id];
                      const isError = segmentStatuses[seg.id] === 'error';
                      
                      let containerClass = 'border-white/5 hover:bg-white/[0.02]';
                      if (activeSegmentId === seg.id) containerClass = 'bg-white/[0.05] border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.1)]';
                      else if (isError) containerClass = 'bg-red-500/10 border-red-500/30';
                      else if (hasAudio) containerClass = 'bg-green-500/5 border-green-500/20';

                      return (
                      <div id={`seg-${seg.id}`} key={seg.id} onClick={() => { if(videoRef.current){ videoRef.current.currentTime = seg.startTime; setCurrentTime(seg.startTime); stopAllAudio(); }}} className={`p-5 rounded-2xl border transition-all cursor-pointer ${containerClass}`}>
                          <div className="flex justify-between mb-2">
                              <div className="flex gap-2 items-center">
                                 <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold" title={spk?.voiceQuality}>{spk?.gender === 'Male' ? 'M' : 'F'}</div>
                                 {isEditingTimings ? (
                                     <div className="flex gap-1"><input type="number" value={seg.startTime} onChange={e => setTempSegments(p => p.map(s => s.id === seg.id ? {...s, startTime: +e.target.value} : s))} className="w-12 bg-black/40 border border-white/10 rounded text-[10px] p-1 text-white"/></div>
                                 ) : <span className="text-[10px] font-mono text-gray-500">{seg.startTime.toFixed(1)}s</span>}
                              </div>
                              {activeSegmentId === seg.id && isPlaying && <div className="flex gap-0.5 items-end h-3"><div className="w-0.5 h-full bg-green-500 animate-[bounce_1s_infinite]"/><div className="w-0.5 h-2/3 bg-green-500 animate-[bounce_1.2s_infinite]"/><div className="w-0.5 h-full bg-green-500 animate-[bounce_0.8s_infinite]"/></div>}
                              {!isEditingTimings && <button onClick={(e) => { e.stopPropagation(); setSegmentToSplit(seg); setSplitTexts({left: seg.translatedText.slice(0, seg.translatedText.length/2), right: seg.translatedText.slice(seg.translatedText.length/2)}); setSplitModalOpen(true); }} className="opacity-50 hover:opacity-100"><Scissors className="w-3 h-3 text-gray-400"/></button>}
                          </div>
                          <p className={`text-sm font-ethiopic ${activeSegmentId === seg.id ? 'text-green-300' : 'text-gray-400'}`}>{seg.translatedText}</p>
                          
                          {segmentStatuses[seg.id] === 'generating' && (
                              <div className="mt-2 text-[10px] text-blue-400 flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping"/>
                                  {t.generating}
                              </div>
                          )}
                          
                          {segmentStatuses[seg.id] === 'error' && !isEditingTimings && (
                              <div className="mt-3 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                                  <div className="flex items-start gap-2 mb-2">
                                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                      <div className="flex-1">
                                          <p className="text-xs text-red-300 font-bold">{t.failedSegment}</p>
                                          <p className="text-[10px] text-red-400/80 mt-1">{segmentErrors[seg.id] || "Unknown error"}</p>
                                      </div>
                                  </div>
                                  <button onClick={(e) => { e.stopPropagation(); generateSegmentAudio(seg, analysis?.speakers||[]); }} className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-200 text-xs font-medium transition-colors flex items-center justify-center gap-2">
                                      <RefreshCw className="w-3 h-3"/> {t.retry}
                                  </button>
                              </div>
                          )}
                      </div>
                  )})}
              </div>
           </GlassCard>
       </div>

       {/* Voice Studio Modal */}
       {showVoiceStudio && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
               <GlassCard className="w-full max-w-lg p-8 bg-gray-900 border-white/10 rounded-[2rem]">
                   <div className="flex justify-between mb-6"><h3 className="font-bold text-white font-ethiopic">{t.voiceStudio}</h3><button onClick={() => setShowVoiceStudio(false)}><X/></button></div>
                   <div className="p-6 rounded-2xl bg-black/40 border border-white/10 text-center">
                       <UserPlus className="w-12 h-12 text-blue-400 mx-auto mb-4" />
                       <input type="file" accept="audio/*" onChange={handleVoiceUpload} className="hidden" id="v-up"/>
                       <label htmlFor="v-up" className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-medium cursor-pointer flex items-center gap-2 justify-center mx-auto w-fit font-ethiopic text-sm">
                           {isAnalyzingVoice ? <RefreshCw className="animate-spin w-4 h-4"/> : <Upload className="w-4 h-4"/>} {t.cloneVoice}
                       </label>
                   </div>
                   {clonedVoices.length > 0 && <div className="mt-6 space-y-2">{clonedVoices.map(c => <div key={c.id} className="p-3 rounded-xl bg-white/5 text-xs text-gray-300 flex justify-between"><span>{c.name}</span><span className="text-gray-500">{c.baseVoice}</span></div>)}</div>}
               </GlassCard>
           </div>
       )}

       {/* Split Modal */}
       {splitModalOpen && segmentToSplit && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
               <GlassCard className="w-full max-w-lg p-8 bg-gray-900 border-white/10 rounded-[2rem]">
                   <h3 className="font-bold mb-6 text-white font-ethiopic">{t.confirmSplit}</h3>
                   <textarea value={splitTexts.left} onChange={e => setSplitTexts({...splitTexts, left: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl p-3 mb-4 text-white text-sm font-ethiopic h-20"/>
                   <textarea value={splitTexts.right} onChange={e => setSplitTexts({...splitTexts, right: e.target.value})} className="w-full bg-black border border-white/10 rounded-xl p-3 mb-6 text-white text-sm font-ethiopic h-20"/>
                   <div className="flex justify-end gap-3">
                       <button onClick={() => setSplitModalOpen(false)} className="px-5 py-2 rounded-xl hover:bg-white/5 text-gray-400 font-ethiopic text-sm">{t.cancel}</button>
                       <button onClick={() => {
                           if (!analysis) return;
                           const dur = segmentToSplit.endTime - segmentToSplit.startTime;
                           const splitP = splitTexts.left.length / (splitTexts.left.length + splitTexts.right.length);
                           const mid = segmentToSplit.startTime + (dur * splitP);
                           const s1 = { ...segmentToSplit, id: segmentToSplit.id+'a', endTime: mid, translatedText: splitTexts.left, originalText: splitTexts.left };
                           const s2 = { ...segmentToSplit, id: segmentToSplit.id+'b', startTime: mid, translatedText: splitTexts.right, originalText: splitTexts.right };
                           const newSegs = analysis.segments.flatMap(s => s.id === segmentToSplit.id ? [s1, s2] : [s]).sort((a,b) => a.startTime - b.startTime);
                           setAnalysis({...analysis, segments: newSegs});
                           generateSegmentAudio(s1, analysis.speakers || []); generateSegmentAudio(s2, analysis.speakers || []);
                           setSplitModalOpen(false);
                       }} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-medium font-ethiopic text-sm">{t.confirmSplit}</button>
                   </div>
               </GlassCard>
           </div>
       )}
    </div>
  );
};