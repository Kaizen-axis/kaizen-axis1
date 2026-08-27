import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PremiumCard, RoundedButton, SectionHeader, StatusBadge } from '@/components/ui/PremiumComponents';
import { ChevronLeft, MapPin, Building2, DollarSign, FileText, PlayCircle, Phone, Share2, Download, MessageCircle, X, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useApp, Development } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function DevelopmentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { developments } = useApp();
  const { isBroker } = useAuthorization();
  const [development, setDevelopment] = useState<Development | null>(null);
  const [activeImage, setActiveImage] = useState(0);

  // Lightbox State
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxType, setLightboxType] = useState<'image' | 'video'>('image');

  useEffect(() => {
    const found = developments.find(d => d.id === id);
    if (found) setDevelopment(found);
  }, [id, developments]);

  const handleOpenBook = () => {
    if (development?.book_pdf_url) {
      window.open(development.book_pdf_url, '_blank');
    } else {
      alert('Book digital indisponível para este empreendimento.');
    }
  };

  const handleWhatsApp = () => {
    if (development?.contact?.phone) {
      const phone = development.contact.phone.replace(/\D/g, '');
      window.open(`https://wa.me/55${phone}`, '_blank');
    }
  };

  const openLightbox = (index: number, type: 'image' | 'video' = 'image') => {
    setLightboxIndex(index);
    setLightboxType(type);
    setIsLightboxOpen(true);
  };

  const nextLightboxItem = () => {
    if (!development) return;
    const totalImages = development.images.length;
    const hasVideo = !!development.videoUrl;
    const totalItems = hasVideo ? totalImages + 1 : totalImages;

    let nextIndex = lightboxIndex + 1;

    if (nextIndex >= totalItems) {
      nextIndex = 0;
    }

    // If video is the last item
    if (hasVideo && nextIndex === totalImages) {
      setLightboxType('video');
    } else {
      setLightboxType('image');
    }

    setLightboxIndex(nextIndex);
  };

  const prevLightboxItem = () => {
    if (!development) return;
    const totalImages = development.images.length;
    const hasVideo = !!development.videoUrl;
    const totalItems = hasVideo ? totalImages + 1 : totalImages;

    let prevIndex = lightboxIndex - 1;

    if (prevIndex < 0) {
      prevIndex = totalItems - 1;
    }

    if (hasVideo && prevIndex === totalImages) {
      setLightboxType('video');
    } else {
      setLightboxType('image');
    }

    setLightboxIndex(prevIndex);
  };

  if (!development) return (
    <div className="p-6 flex items-center justify-center min-h-screen">
      <div className="text-center text-text-secondary">
        <Building2 size={48} className="mx-auto mb-3 opacity-30" />
        <p>Empreendimento não encontrado.</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-gold-500 text-sm">Voltar</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-50 pb-24">
      {/* Header Image & Nav */}
      <div className="relative h-72 w-full group cursor-pointer" onClick={() => openLightbox(activeImage)}>
        <img
          src={development.images[activeImage]}
          alt={development.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-surface-50" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
          <span className="bg-black/50 text-white px-4 py-2 rounded-full text-sm backdrop-blur-sm">Ver em tela cheia</span>
        </div>

        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full bg-black/20 backdrop-blur-md text-white hover:bg-black/40 transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex gap-2">
            <button className="p-2 rounded-full bg-black/20 backdrop-blur-md text-white hover:bg-black/40 transition-colors">
              <Share2 size={20} />
            </button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-6">
          <StatusBadge status={development.status || ''} className="mb-2 bg-card-bg/90 dark:bg-black/80 backdrop-blur-sm shadow-sm border-none" />
          <h1 className="text-3xl font-bold text-text-primary mb-1">{development.name}</h1>
          <p className="text-text-secondary flex items-center gap-1 text-sm">
            <Building2 size={14} /> {development.builder}
          </p>
        </div>
      </div>

      {/* Gallery Thumbs */}
      <div className="px-6 -mt-4 mb-6 flex gap-2 overflow-x-auto overscroll-x-contain no-scrollbar relative z-10">
        {(development.images || []).map((img, idx) => (
          <button
            key={idx}
            onClick={() => setActiveImage(idx)}
            onDoubleClick={() => openLightbox(idx)}
            className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all ${activeImage === idx ? 'border-gold-400 scale-105 shadow-md' : 'border-transparent opacity-70'
              }`}
          >
            <img src={img} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </button>
        ))}
      </div>

      <div className="px-6 space-y-8">
        {/* Main Info */}
        <section className="grid grid-cols-2 gap-4">
          <PremiumCard className="flex flex-col justify-center items-center text-center py-4">
            <DollarSign className="text-gold-500 mb-2" size={24} />
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Preço</p>
            <p className="text-sm font-bold text-text-primary">{development.price}</p>
          </PremiumCard>
          <PremiumCard className="flex flex-col justify-center items-center text-center py-4">
            <Building2 className="text-gold-500 mb-2" size={24} />
            <p className="text-[10px] text-text-secondary uppercase tracking-wider">Renda Ideal</p>
            <p className="text-sm font-bold text-text-primary">{development.min_income}</p>
          </PremiumCard>
        </section>

        {/* Description & Differentials */}
        <section className="space-y-4">
          <SectionHeader title="Sobre o Empreendimento" />
          <p className="text-text-secondary leading-relaxed text-sm">
            {development.description}
          </p>

          <div className="grid grid-cols-2 gap-3 mt-4">
            {(development.differentials || []).map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-gold-400 mt-1.5 flex-shrink-0" />
                <span className="text-sm text-text-primary">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Location */}
        <section className="space-y-4">
          <SectionHeader title="Localização" />
          <PremiumCard className="p-0 overflow-hidden">
            {/* Map */}
            <div className="h-40 bg-surface-200 relative flex items-center justify-center group cursor-pointer" onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(development.address)}`, '_blank')}>
              <iframe
                width="100%"
                height="100%"
                frameBorder="0"
                scrolling="no"
                marginHeight={0}
                marginWidth={0}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(development.address)}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                title="Mapa"
              ></iframe>
              <button className="absolute bottom-3 right-3 bg-card-bg dark:bg-black text-xs font-medium px-3 py-1.5 rounded-lg shadow-sm z-10 pointer-events-none">
                Abrir no Maps
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-text-primary flex items-start gap-2">
                <MapPin size={16} className="text-gold-500 mt-0.5 flex-shrink-0" />
                {development.address}
              </p>
            </div>
          </PremiumCard>
        </section>

        {/* Book PDF */}
        <section>
          <PremiumCard
            className="flex items-center justify-between bg-gray-900 dark:bg-card-bg text-white dark:text-text-primary cursor-pointer hover:opacity-90 transition-opacity"
            onClick={handleOpenBook}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-card-bg/10 dark:bg-black/10 flex items-center justify-center">
                <FileText size={20} />
              </div>
              <div>
                <p className="font-bold text-sm">Book Digital</p>
                <p className="text-xs opacity-70">PDF Completo • 12MB</p>
              </div>
            </div>
            <button className="p-2 hover:bg-card-bg/10 dark:hover:bg-black/10 rounded-full transition-colors">
              <Download size={20} />
            </button>
          </PremiumCard>
        </section>

        {/* Contact — hidden from CORRETOR */}
        {!isBroker && development.contact && (development.contact.name || development.contact.phone) && (
          <section className="space-y-4">
            <SectionHeader title="Viabilizador Responsável" />
            <PremiumCard className="flex items-center gap-4">
              {development.contact.avatar ? (
                <img src={development.contact.avatar} alt={development.contact.name} className="w-14 h-14 rounded-full object-cover border-2 border-surface-100" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-surface-200 flex items-center justify-center text-text-secondary font-bold text-xl">{(development.contact.name || '?').charAt(0)}</div>
              )}
              <div className="flex-1">
                <h4 className="font-bold text-text-primary">{development.contact.name}</h4>
                <p className="text-xs text-text-secondary">{development.contact.role}</p>
                <p className="text-xs text-gold-600 dark:text-gold-400 font-medium mt-0.5">{development.builder}</p>
              </div>
            </PremiumCard>

            {development.contact.phone && (
              <div className="grid grid-cols-2 gap-3">
                <RoundedButton
                  className="w-full flex items-center justify-center gap-2"
                  href={`tel:+55${(development.contact?.phone || '').replace(/\D/g, '')}`}
                >
                  <Phone size={18} /> Ligar
                </RoundedButton>
                <RoundedButton variant="outline" className="w-full flex items-center justify-center gap-2 border-green-500 text-green-600 hover:bg-success-subtle" onClick={handleWhatsApp}>
                  <MessageCircle size={18} /> WhatsApp
                </RoundedButton>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Lightbox Modal */}
      {isLightboxOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(false);
            }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-card-bg/10 rounded-full z-[60] cursor-pointer hover:bg-card-bg/20 transition-colors"
          >
            <X size={24} />
          </button>

          <div className="w-full max-w-4xl h-[70vh] flex items-center justify-center relative">
            {lightboxType === 'image' && (development.images || [])[lightboxIndex] && (
              <img
                src={(development.images || [])[lightboxIndex]}
                alt="Fullscreen"
                className="max-w-full max-h-full object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            )}

            {/* Navigation Arrows */}
            <button
              onClick={(e) => { e.stopPropagation(); prevLightboxItem(); }}
              className="absolute left-2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 backdrop-blur-sm"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); nextLightboxItem(); }}
              className="absolute right-2 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 backdrop-blur-sm"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          <div className="mt-6 flex gap-2 overflow-x-auto overscroll-x-contain max-w-full p-2">
            {(development.images || []).map((img, idx) => (
              <button key={idx} onClick={() => { setLightboxIndex(idx); setLightboxType('image'); }}
                className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all ${lightboxIndex === idx && lightboxType === 'image' ? 'border-gold-400 opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
                  }`}>
                <img src={img} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
