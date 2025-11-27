import React, { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, className = '', onClick }) => {
  return (
    <div 
      onClick={onClick}
      className={`
        backdrop-blur-3xl 
        bg-black/40 
        border border-white/10 
        rounded-[2rem] 
        shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] 
        ${className}
      `}
    >
      {children}
    </div>
  );
};

export const NeonButton: React.FC<{ children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger', className?: string, disabled?: boolean }> = ({ 
  children, onClick, variant = 'primary', className = '', disabled = false
}) => {
  const styles = {
    primary: "bg-white/10 text-white border-white/20 hover:bg-white/20 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)]",
    secondary: "bg-black/40 text-gray-300 border-white/10 hover:bg-black/60 hover:text-white hover:border-white/20",
    danger: "bg-red-500/10 text-red-200 border-red-500/20 hover:bg-red-500/20"
  };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`
        px-6 py-4 
        rounded-2xl 
        border 
        font-medium 
        tracking-wide
        transition-all 
        duration-300 
        flex items-center justify-center gap-3
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none
        active:scale-95
        ${styles[variant]}
        ${className}
      `}
    >
      {children}
    </button>
  );
}