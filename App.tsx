import React, { useState } from 'react';
import { VideoDubber } from './components/VideoDubber';
import { Sparkles, Home, Languages } from 'lucide-react';

const App: React.FC = () => {
  // Use a key to force re-mounting of the VideoDubber component to reset its state
  const [resetKey, setResetKey] = useState(0);
  const [interfaceLang, setInterfaceLang] = useState<'am' | 'en'>('am');

  const handleHomeClick = () => {
    setResetKey(prev => prev + 1);
  };

  const toggleLanguage = () => {
    setInterfaceLang(prev => prev === 'am' ? 'en' : 'am');
  };

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-black to-black text-white selection:bg-blue-500/30 overflow-x-hidden">
      
      {/* Glass Navbar */}
      <header className="h-20 sm:h-24 fixed top-0 w-full z-50 pointer-events-none">
         <div className="w-full h-full bg-gradient-to-b from-black/90 to-transparent pointer-events-auto backdrop-blur-[2px]">
            <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
              <div className="flex items-center gap-4 sm:gap-6">
                 <div className="flex items-center gap-3 sm:gap-4 cursor-pointer group" onClick={handleHomeClick}>
                     <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.05)] group-hover:shadow-[0_0_50px_rgba(59,130,246,0.2)] transition-all duration-500">
                        <Sparkles className="text-blue-400 w-5 h-5 sm:w-6 sm:h-6 group-hover:scale-110 transition-transform" />
                     </div>
                     <div>
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight font-ethiopic text-white">NebulaDub</h1>
                        <span className="text-[8px] sm:text-[10px] uppercase tracking-[0.2em] text-gray-500">AI Voice Studio</span>
                     </div>
                 </div>
              </div>
              
              <div className="flex items-center gap-3">
                 <button
                    onClick={toggleLanguage}
                    className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-gray-300 hover:text-white"
                    title="Switch Language"
                 >
                    <Languages className="w-4 h-4" />
                    <span className="text-xs font-medium font-ethiopic">{interfaceLang === 'am' ? 'English' : 'አማርኛ'}</span>
                 </button>

                 <button 
                    onClick={handleHomeClick}
                    className="p-2 sm:p-3 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all text-gray-400 hover:text-white"
                    title={interfaceLang === 'am' ? 'መነሻ' : 'Home'}
                 >
                    <Home className="w-5 h-5" />
                 </button>
              </div>
            </div>
         </div>
      </header>

      {/* Main Content */}
      <main className="pt-24 sm:pt-32 pb-6 px-4 sm:px-6 max-w-screen-2xl mx-auto w-full min-h-screen flex flex-col">
         <VideoDubber key={resetKey} interfaceLang={interfaceLang} />
      </main>
      
    </div>
  );
};

export default App;