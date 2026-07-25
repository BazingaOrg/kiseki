import {useEffect} from 'react';

interface LightboxProps {
  src: string;
  onClose: () => void;
}

export const Lightbox = ({src, onClose}: LightboxProps) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="关闭">
        ×
      </button>
      <img className="lightbox-image" src={src} alt="" onClick={(event) => event.stopPropagation()} />
    </div>
  );
};
