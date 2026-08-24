import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronLeft, Send, Mic, Image as ImageIcon,
  FileText, Camera, X, MoreVertical, Phone, Plus, Loader2,
  Download, SwitchCamera, Circle, Square, Bot, Play, Pause,
  Maximize, Volume2, VolumeX, PictureInPicture, Lock, Eye, EyeOff,
  Search as SearchIcon, CornerUpLeft, CheckCheck, Check, Smile, Trash2, Copy
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sendMessageToKai } from '@/services/kaiAgent';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { ChatDetailHeader } from '@/components/chat/ChatDetailHeader';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { getChatAudioExtension, getSupportedChatAudioMimeType } from '@/lib/chat-audio';

interface ChatMessage {
  id: string;
  senderId: string;
  text?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document';
  mediaUrl?: string;
  fileName?: string;
  timestamp: string;
  isMe: boolean;
  // View Once fields
  viewOnce?: boolean;
  isLocked?: boolean;
  viewedAt?: string | null;
  mediaPath?: string;
  // New features
  reply_to_id?: string | null;
  reactions?: Record<string, string[]>;
  deliveryStatus?: 'sending' | 'sent';
  // Soft delete
  is_deleted?: boolean;
  deleted_for?: string[];
}

interface ChatUser {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
  isAI?: boolean;
}

const resolveChatName = (profile?: { chat_display_name?: string | null; name?: string | null } | null) =>
  profile?.chat_display_name?.trim() || profile?.name?.trim() || 'Usuario';

// Detect best supported video MIME type for this device/browser
function getSupportedVideoMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1,mp4a.40.2', // iOS specific
    'video/mp4', // Base iOS fallback
  ];
  for (const type of types) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch { /* ignore */ }
  }
  return ''; // let browser decide
}

// ─── View Once Card ──────────────────────────────────────────────────────────
const ViewOnceCard = (
  { msg, onOpen }: { msg: ChatMessage; onOpen: () => void }
) => (
  <button
    onClick={onOpen}
    className="flex items-center gap-3 py-0.5 w-full active:opacity-60 transition-opacity"
  >
    <div className="w-9 h-9 rounded-full bg-black/10 dark:bg-card-bg/10 flex items-center justify-center flex-shrink-0">
      {msg.type === 'video'
        ? <Play size={16} className="text-text-primary fill-current ml-0.5" />
        : msg.type === 'text'
          ? <Eye size={16} className="text-text-primary" />
          : <ImageIcon size={16} className="text-text-primary" />}
    </div>
    <div className="flex flex-col items-start min-w-0">
      <span className="text-sm font-medium text-text-primary leading-tight">Visualização única</span>
      <span className="text-[11px] text-text-secondary">
        {msg.type === 'text' ? 'Toque para ler' : 'Toque para abrir'}
      </span>
    </div>
    <Lock size={12} className="text-text-secondary ml-auto flex-shrink-0 opacity-60" />
  </button>
);

// ─── View Once Modal ─────────────────────────────────────────────────────────
const ViewOnceModal = ({
  messageId,
  type,
  onClose,
}: {
  messageId: string;
  type: ChatMessage['type'];
  onClose: () => void;
}) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let url = '';
    const fetchUrl = async () => {
      setLoading(true);
      // Get the current user session to pass the bearer token to the Edge Function
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setError('Sessão expirada. Faça login novamente.');
        setLoading(false);
        return;
      }
      const { data, error: fnError } = await supabase.functions.invoke('generate-view-once-url', {
        body: { message_id: messageId },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (fnError || !data?.signedUrl) {
        setError('Não foi possível abrir a mídia.');
        setLoading(false);
        return;
      }
      url = data.signedUrl as string;
      setSignedUrl(url);
      setLoading(false);
      // Auto-close after 30 seconds (URL expiry)
      timerRef.current = setTimeout(() => {
        setSignedUrl(null);
        onClose();
      }, 29000);
    };
    fetchUrl();
    return () => {
      // Wipe signed URL from memory on unmount
      setSignedUrl(null);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [messageId]);

  const handleClose = () => {
    setSignedUrl(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col" onClick={handleClose}>
      <div className="flex items-center justify-between p-4 text-white">
        <button onClick={handleClose} className="p-2 hover:bg-card-bg/10 rounded-full">
          <X size={24} />
        </button>
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Eye size={14} /> Visualização Única
        </span>
        <div className="w-10" /> {/* spacer */}
      </div>

      <div
        className="flex-1 flex items-center justify-center p-4"
        onClick={e => e.stopPropagation()}
        onContextMenu={e => e.preventDefault()}
      >
        {loading && <Loader2 size={32} className="animate-spin text-white" />}
        {error && <p className="text-white text-center">{error}</p>}
        {signedUrl && !loading && (
          <>
            {(type === 'image') && (
              <img
                src={signedUrl}
                alt=""
                className="max-w-full max-h-full object-contain rounded-lg select-none"
                draggable={false}
                onContextMenu={e => e.preventDefault()}
              />
            )}
            {type === 'video' && (
              <video
                src={signedUrl}
                controls
                autoPlay
                playsInline
                controlsList="nodownload nofullscreen"
                className="max-w-full max-h-full rounded-lg"
                onContextMenu={e => e.preventDefault()}
              />
            )}
            {type === 'document' && (
              <iframe
                src={signedUrl}
                className="w-full h-full rounded-lg"
                title="Documento"
              />
            )}
          </>
        )}
      </div>
      <div className="p-4 text-center">
        <p className="text-white/50 text-xs">Esta mídia desaparecerá após fechar</p>
      </div>
    </div>
  );
};


// ─── Custom Audio Player with Waveform ──────────────────────────────────────
const AudioMessage = ({ url, isMe }: { url: string; isMe: boolean }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const initialized = useRef(false);

  // Redraw static bars when paused or when seek position changes
  useEffect(() => {
    if (!isPlaying) drawStatic();
  }, [isPlaying, currentTime, duration]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Pseudo-random waveform that looks like a real voice recording
  const WAVE = [4, 9, 14, 7, 18, 11, 5, 20, 8, 15, 6, 22, 13, 9, 4, 12, 19, 8, 14, 7, 21, 10, 5, 16, 11, 8, 17, 6, 13, 9];

  const drawStatic = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barCount = WAVE.length;
    const barWidth = Math.floor((canvas.width - (barCount - 1) * 2) / barCount);
    const progress = duration > 0 ? currentTime / duration : 0;

    for (let i = 0; i < barCount; i++) {
      const barHeight = Math.max(3, (WAVE[i] / 22) * canvas.height * 0.85);
      const x = i * (barWidth + 2);
      const y = canvas.height / 2 - barHeight / 2;
      const played = i / barCount < progress;

      if (isMe) {
        ctx.fillStyle = played ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)';
      } else {
        ctx.fillStyle = played ? 'rgba(180,140,30,0.95)' : 'rgba(0,0,0,0.18)';
      }
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      if (!initialized.current) {
        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioCtx();
          ctxRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          const source = audioCtx.createMediaElementSource(audioRef.current);
          source.connect(analyser);
          analyser.connect(audioCtx.destination);
          analyserRef.current = analyser;
          initialized.current = true;
        } catch (e) {
          console.warn('AudioContext not supported or failed cross-origin.', e);
        }
      }
      if (ctxRef.current?.state === 'suspended') {
        ctxRef.current.resume();
      }
      audioRef.current.play().catch(console.error);
    }
  };

  const drawVisualizer = () => {
    if (!analyserRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const drawFrame = () => {
      if (!isPlaying) return;
      animationRef.current = requestAnimationFrame(drawFrame);
      analyserRef.current!.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barCount = 30;
      const barWidth = (canvas.width / barCount) - 2;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const percent = value / 255;
        const barHeight = Math.max(3, percent * canvas.height * 0.85);

        ctx.fillStyle = isMe ? 'rgba(255,255,255,0.95)' : 'rgba(180,140,30,0.9)';
        ctx.beginPath();
        const x = i * (barWidth + 2);
        const y = canvas.height / 2 - barHeight / 2;
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    drawFrame();
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const toggleSpeed = () => {
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  return (
    <div className="flex items-center gap-2.5 w-full min-w-[210px] max-w-[260px] py-0.5">
      {/* Play / Pause */}
      <button
        onClick={togglePlay}
        className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full transition-colors shadow-sm flex-shrink-0
          ${isMe
            ? 'bg-card-bg/90 text-green-700 hover:bg-card-bg active:bg-card-bg/80'
            : 'bg-gold-500 text-white hover:bg-gold-600'}`}
      >
        {isPlaying
          ? <Pause size={15} fill="currentColor" />
          : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>

      {/* Waveform + meta */}
      <div className="flex-1 min-w-0">
        <div className="relative h-7">
          <canvas
            ref={canvasRef}
            width={140}
            height={28}
            className="w-full h-full pointer-events-none"
          />
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className={`text-[10px] tabular-nums font-medium ${isMe ? 'text-white/90' : 'text-text-secondary'}`}>
            {formatTime(isPlaying ? currentTime : duration)}
          </span>
          <button
            onClick={toggleSpeed}
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full z-20 relative transition-colors
              ${isMe ? 'bg-card-bg/30 text-white hover:bg-card-bg/45' : 'bg-black/10 text-text-secondary hover:bg-black/18'}`}
          >
            {playbackRate}x
          </button>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={url}
        crossOrigin="anonymous"
        onPlay={() => { setIsPlaying(true); drawVisualizer(); }}
        onPause={() => { setIsPlaying(false); if (animationRef.current) cancelAnimationFrame(animationRef.current); }}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); if (animationRef.current) cancelAnimationFrame(animationRef.current); }}
        onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
};


export default function ChatDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, allProfiles, profile } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();

  const [chatUser, setChatUser] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showAttachments, setShowAttachments] = useState(false);
  const [isKaiTyping, setIsKaiTyping] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [recordingUser, setRecordingUser] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [viewOnceModalMsgId, setViewOnceModalMsgId] = useState<string | null>(null);
  const [viewOnceTextMsgId, setViewOnceTextMsgId] = useState<string | null>(null);

  // Pagination
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ msg: ChatMessage; x: number; y: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reply/Quote
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // KAI client context
  const [clientContext, setClientContext] = useState<{ name: string; phone?: string; status?: string } | null>(null);

  // Presence: is other user online
  const [isOtherOnline, setIsOtherOnline] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const [audioVolumes, setAudioVolumes] = useState<number[]>(Array(20).fill(10));
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Camera
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null); // state so useEffect fires on switch
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const chatChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: string; name?: string } | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: ChatMessage['type']; file: File } | null>(null);

  const isKAI = id === 'kai-agent';
  const myId = user?.id ?? '';
  const myName = profile?.name || 'Usuário';
  const legacyConversationId = isKAI || !id ? null : [myId, id].sort().join('_');
  const conversationId = isKAI ? `kai-${myId}` : [myId, id].sort().join('-');
  const { markConversationRead } = useChatUnread();

  // ─── Load chat partner ────────────────────────────────────────────────────
  useEffect(() => {
    if (isKAI) {
      setChatUser({ id: 'kai-agent', name: 'KAI — Assistente IA', isAI: true });
      return;
    }
    if (!id) {
      setChatUser(null);
      return;
    }
    const found = allProfiles.find(p => p.id === id);
    if (found) {
      setChatUser({
        id: found.id,
        name: resolveChatName(found),
        avatar: (found as any).chat_avatar_url || (found as any).avatar_url,
        role: found.role,
      });
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, name, role, avatar_url, chat_display_name, chat_avatar_url')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          setChatUser({
            id: data.id,
            name: resolveChatName(data),
            avatar: data.chat_avatar_url || data.avatar_url,
            role: data.role,
          });
        } else {
          setChatUser({ id, name: 'Usuario' });
        }
      });
    return () => { cancelled = true; };
  }, [id, allProfiles, isKAI]);

  // ─── Upload to Supabase Storage ──────────────────────────────────────────
  // TTL curto para display (path é persistido em media_path para refresh futuro, C-01)
  const SIGNED_URL_TTL = 3600;
  const uploadMedia = async (file: File, type: ChatMessage['type']): Promise<{ signedUrl: string; path: string } | null> => {
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${conversationId}/${Date.now()}_${type}.${ext}`;
    const { error } = await supabase.storage.from('chat-media').upload(path, file, {
      contentType: file.type,
    });
    if (error) {
      console.error('Upload error:', error);
      alert(`Falha ao enviar arquivo: ${error.message}`);
      return null;
    }
    // P1-01: use local blob URL for immediate display — signed URL resolved via Edge Function on reload
    const signedUrl = URL.createObjectURL(file);
    return { signedUrl, path };
  };

  // ─── Upload to private bucket (view-once only) ────────────────────────────
  const uploadMediaPrivate = async (file: File, type: ChatMessage['type']): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${conversationId}/${Date.now()}_${type}.${ext}`;
    const { error } = await supabase.storage.from('chat-media-private').upload(path, file, {
      contentType: file.type,
    });
    if (error) { console.error('Private upload error:', error); return null; }
    return path; // Return the path only – no public URL
  };

  // ─── Load history ─────────────────────────────────────────────────────────
  const PAGE_SIZE = 50;

  const mapMsg = useCallback((m: any): ChatMessage => ({
    id: m.id,
    senderId: m.sender_id,
    text: m.content,
    type: m.type as ChatMessage['type'],
    mediaUrl: m.media_url,
    fileName: m.file_name,
    timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isMe: m.sender_id === myId,
    viewOnce: m.view_once ?? false,
    isLocked: m.is_locked ?? false,
    viewedAt: m.viewed_at ?? null,
    mediaPath: m.media_path ?? null,
    reply_to_id: m.reply_to_id ?? null,
    reactions: m.reactions ?? {},
    deliveryStatus: 'sent',
    is_deleted: m.is_deleted ?? false,
    deleted_for: m.deleted_for ?? [],
  }), [myId]);

  // Gera URLs frescas a partir de media_path via Edge Function (P1-01: valida membership server-side)
  // Também converte URLs públicas antigas do bucket chat-media (que agora é privado)
  const resolveMediaPaths = useCallback(async (msgs: ChatMessage[]): Promise<ChatMessage[]> => {
    const PUBLIC_MARKER = '/object/public/chat-media/';
    const toResolve = msgs.filter(m => {
      if (m.viewOnce) return false;
      if (m.mediaPath) return true;
      // Mensagens antigas com URL pública — bucket agora é privado, precisa de signed URL
      if (m.mediaUrl?.includes(PUBLIC_MARKER)) return true;
      return false;
    });
    if (toResolve.length === 0) return msgs;
    const resolved = await Promise.all(
      toResolve.map(async m => {
        let storagePath = m.mediaPath ?? null;
        // Extrai path de URL pública antiga
        if (!storagePath && m.mediaUrl?.includes(PUBLIC_MARKER)) {
          const idx = m.mediaUrl.indexOf(PUBLIC_MARKER);
          storagePath = m.mediaUrl.slice(idx + PUBLIC_MARKER.length);
        }
        if (!storagePath) return { id: m.id, signedUrl: m.mediaUrl ?? '' };
        try {
          const { data, error } = await supabase.functions.invoke('get-chat-media-url', {
            body: { path: storagePath },
          });
          if (error || !data?.signedUrl) return { id: m.id, signedUrl: m.mediaUrl ?? '' };
          return { id: m.id, signedUrl: data.signedUrl };
        } catch {
          return { id: m.id, signedUrl: m.mediaUrl ?? '' };
        }
      })
    );
    const map = new Map(resolved.map(r => [r.id, r.signedUrl]));
    return msgs.map(m => map.has(m.id) ? { ...m, mediaUrl: map.get(m.id) } : m);
  }, []);

  const loadMessages = useCallback(async () => {
    if (isKAI || !myId) return;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .in('conversation_id', legacyConversationId ? [conversationId, legacyConversationId] : [conversationId])
      .not('deleted_for', 'cs', `{"${myId}"}`)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);
    if (error) return;
    const mapped = (data ?? []).map(mapMsg).reverse();
    const withFreshUrls = await resolveMediaPaths(mapped);
    setMessages(withFreshUrls);
    setHasMore((data ?? []).length === PAGE_SIZE);
  }, [conversationId, legacyConversationId, isKAI, myId, mapMsg, resolveMediaPaths]);

  const loadMoreMessages = useCallback(async () => {
    if (isLoadingMore || !hasMore || !myId) return;
    setIsLoadingMore(true);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .in('conversation_id', legacyConversationId ? [conversationId, legacyConversationId] : [conversationId])
      .not('deleted_for', 'cs', `{"${myId}"}`)
      .order('created_at', { ascending: false })
      .range(messages.length, messages.length + PAGE_SIZE - 1);
    const older = (data ?? []).map(mapMsg).reverse();
    setMessages(prev => [...older, ...prev]);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setIsLoadingMore(false);
  }, [conversationId, legacyConversationId, hasMore, isLoadingMore, mapMsg, messages.length, myId]);

  // ─── Realtime: postgres_changes (messages) + presence (typing) ────────────
  useEffect(() => {
    if (isKAI || !myId || !id) return;
    loadMessages();

    // Single channel handles postgres_changes, broadcast AND presence
    const channel = supabase.channel(`chat:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    chatChannelRef.current = channel;

    // Listen for NEW rows in chat_messages for this conversation
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const m = payload.new as any;
        // Push notification when app is in background
        if (document.hidden && m.sender_id !== myId && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(sw => {
            sw.showNotification(chatUser?.name ?? 'Nova mensagem', {
              body: m.content || (m.type === 'image' ? '📷 Imagem' : m.type === 'audio' ? '🎤 Áudio' : '📎 Arquivo'),
              icon: '/pwa-192x192.svg',
              tag: conversationId,
            } as NotificationOptions);
          }).catch(() => {});
        }
        if (m.sender_id === myId) return;
        setMessages(prev => {
          if (prev.find(x => x.id === m.id)) return prev;
          const newMsg: ChatMessage = {
            id: m.id,
            senderId: m.sender_id,
            text: m.content,
            type: m.type,
            mediaUrl: m.media_url ?? undefined,
            fileName: m.file_name,
            timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isMe: false,
            viewOnce: m.view_once ?? false,
            isLocked: m.is_locked ?? false,
            viewedAt: m.viewed_at ?? null,
            mediaPath: m.media_path ?? null,
            reply_to_id: m.reply_to_id ?? null,
            reactions: m.reactions ?? {},
          };
          // Resolve media URL via Edge Function so recipient sees image immediately
          if (newMsg.mediaPath && !newMsg.viewOnce) {
            resolveMediaPaths([newMsg]).then(resolved => {
              setMessages(curr => curr.map(x => x.id === resolved[0].id ? resolved[0] : x));
            });
          }
          return [...prev, newMsg];
        });
      }
    );

    // Listen for UPDATE rows (soft-delete: is_deleted or deleted_for)
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const m = payload.new as any;
        if (m.is_deleted) {
          // "Apagar para todos" → substitui conteúdo pelo placeholder
          setMessages(prev => prev.map(msg =>
            msg.id === m.id ? { ...msg, is_deleted: true, text: undefined, type: 'text' as const } : msg
          ));
        } else if ((m.deleted_for ?? []).includes(myId)) {
          // "Apagar para mim" → remove da lista do usuário atual
          setMessages(prev => prev.filter(msg => msg.id !== m.id));
        }
      }
    );

    // Broadcast: reaction updates (bypasses postgres_changes UPDATE limitations)
    channel.on('broadcast', { event: 'reaction-update' }, ({ payload }) => {
      const { msgId, reactions } = payload as { msgId: string; reactions: Record<string, string[]> };
      setMessages(prev => prev.map(msg =>
        msg.id === msgId ? { ...msg, reactions } : msg
      ));
    });

    // Presence for typing indicator + online status
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ name: string; isTyping: boolean; isRecordingAudio?: boolean }>();
      const others = Object.values(state)
        .flat()
        .filter((p: any) => p.userId !== myId);
      const recording = others.find((p: any) => p.isRecordingAudio);
      const typing = others.find((p: any) => p.isTyping);
      setRecordingUser(recording ? (recording as any).name : null);
      setTypingUser(typing ? (typing as any).name : null);
      setIsOtherOnline(others.length > 0);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track our presence
        await channel.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
      }
    });

    return () => {
      chatChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, isKAI, myId, id, loadMessages, myName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isKaiTyping, typingUser, recordingUser]);

  // Mark conversation as read when opening
  useEffect(() => {
    if (!myId) return;
    markConversationRead(conversationId);
  }, [myId, conversationId, markConversationRead]);

  // Keep it read while the user is viewing this conversation
  useEffect(() => {
    if (!myId || messages.length === 0) return;
    markConversationRead(conversationId);
  }, [myId, conversationId, messages.length, markConversationRead]);

  // Load KAI history from localStorage
  useEffect(() => {
    if (!isKAI || !myId) return;
    try {
      const saved = localStorage.getItem(`kai-history-${myId}`);
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, [isKAI, myId]);

  // Load client context for KAI when coming from client page
  useEffect(() => {
    const clientId = (location.state as any)?.clientId;
    if (!clientId || !isKAI) return;
    supabase.from('clients').select('name, phone, status').eq('id', clientId).single().then(({ data }) => {
      if (data) setClientContext({ name: data.name, phone: data.phone ?? undefined, status: data.status ?? undefined });
    });
  }, [location.state, isKAI]);

  // Request push notification permission
  useEffect(() => {
    if (!isKAI && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [isKAI]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioContextRef.current?.close();
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      const ch = supabase.getChannels().find(c => c.topic === `realtime:chat:${conversationId}`);
      ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
      stopCamera();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (!isRecording) { setRecordingSeconds(0); return; }
    const t = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  // ─── Assign camera stream to video element whenever stream changes ───────────────────
  // (fires on first open AND on camera switch because cameraStream is state, not a ref)
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // ─── Typing presence broadcast ────────────────────────────────────────────
  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (isKAI) return;

    // Update presence with isTyping = true
    const allChannels = supabase.getChannels();
    const ch = allChannels.find(c => c.topic === `realtime:chat:${conversationId}`);
    const isTyping = value.trim().length > 0;
    ch?.track({ userId: myId, name: myName, isTyping, isRecordingAudio: false });
    if (!isTyping) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      return;
    }

    // Reset typing after 2 seconds of inactivity
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
    }, 2000);
  };

  // ─── Send message ─────────────────────────────────────────────────────────
  const handleSendMessage = async (
    text: string = inputValue,
    type: ChatMessage['type'] = 'text',
    file?: File,
    fileName?: string,
    existingUrl?: string,
    viewOnceFlag?: boolean,
  ) => {
    if (isSendingMessage) return;
    if (!text && !file && !existingUrl) return;

    // Prevent sending empty or corrupted files (0 bytes)
    if (file && file.size === 0) {
      alert('Ocorreu um erro ao processar o arquivo (tamanho 0 bytes). Tente novamente.');
      return;
    }

    if (!chatUser) return;
    setIsSendingMessage(true);
    setInputValue('');
    setShowAttachments(false);

    // Upload media to storage
    let mediaUrl = existingUrl;
    let mediaPath: string | undefined;
    // For text-only messages, use the isViewOnce toggle state when no explicit flag is passed
    const useViewOnce = viewOnceFlag !== undefined ? viewOnceFlag : (type === 'text' && !file ? isViewOnce : false);
    if (type === 'text' && !file) setIsViewOnce(false); // reset toggle after text send

    if (file) {
      setIsUploading(true);
      if (useViewOnce && ['image', 'video', 'document'].includes(type)) {
        // Private upload – no public URL
        const privatePath = await uploadMediaPrivate(file, type);
        setIsUploading(false);
        if (!privatePath) {
          setIsSendingMessage(false);
          alert('Falha ao enviar o arquivo. Tente novamente.');
          return;
        }
        mediaPath = privatePath;
        mediaUrl = undefined; // no public URL for view-once
      } else {
        const uploadResult = await uploadMedia(file, type);
        setIsUploading(false);
        if (!uploadResult && !isKAI) {
          setIsSendingMessage(false);
          alert('Falha ao enviar o arquivo. Tente novamente.');
          return;
        }
        mediaUrl = uploadResult?.signedUrl;
        mediaPath = uploadResult?.path ?? mediaPath;
      }
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tempId = `temp_${Date.now()}`;

    // Optimistic local update
    setMessages(prev => [...prev, {
      id: tempId,
      senderId: myId,
      text: text || undefined,
      type,
      mediaUrl,
      fileName: fileName || file?.name,
      timestamp,
      isMe: true,
      deliveryStatus: 'sending',
      reply_to_id: replyingTo?.id ?? null,
      reactions: {},
    }]);

    // KAI Agent (not persisted to DB)
    if (isKAI && type === 'text' && text) {
      setIsKaiTyping(true);
      const history = messages.map(m => ({
        role: m.isMe ? 'user' : 'assistant' as 'user' | 'assistant',
        content: m.text || '',
      }));
      // Inject client context on first message — only name and status, not phone (P2-03)
      const contextualText = clientContext && messages.filter(m => m.isMe).length === 0
        ? `[Contexto do cliente: ${clientContext.name}${clientContext.status ? `, Status: ${clientContext.status}` : ''}]\n\n${text}`
        : text;
      const responseText = await sendMessageToKai(contextualText, history);
      setIsKaiTyping(false);
      setMessages(prev => {
        const updated = [...prev, {
          id: `kai_${Date.now()}`, senderId: 'kai-agent',
          text: responseText, type: 'text' as const,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isMe: false,
        }];
        // Persist only text content to localStorage — no PII fields (P2-03)
        try {
          const safe = updated.slice(-50).map(m => ({ id: m.id, text: m.text, isMe: m.isMe, timestamp: m.timestamp }));
          localStorage.setItem(`kai-history-${myId}`, JSON.stringify(safe));
        } catch {}
        return updated;
      });
      setIsSendingMessage(false);
      return;
    }
    if (isKAI) {
      setIsSendingMessage(false);
      return;
    }

    // Persist to Supabase (postgres_changes will notify receiver)
    // media_url is intentionally null — blob URLs are local only and must not be stored
    const { data: inserted, error } = await supabase.from('chat_messages').insert({
      sender_id: myId,
      receiver_id: id,
      conversation_id: conversationId,
      content: text || null,
      type,
      media_url: null,
      file_name: fileName || file?.name || null,
      view_once: useViewOnce,
      media_path: mediaPath || null,
      reply_to_id: replyingTo?.id || null,
    }).select().single();

    if (error) {
      console.error('Insert error:', error);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert(error.message || 'Nao foi possivel enviar a mensagem.');
      setIsSendingMessage(false);
      return;
    }

    // Update temp message to confirmed with real ID + mark sent
    // If has mediaPath, resolve signed URL via Edge Function so image shows without reload
    if (inserted) {
      if (mediaPath && !useViewOnce) {
        setMessages(prev => prev.map(m =>
          m.id === tempId ? { ...m, id: inserted.id, deliveryStatus: 'sent', mediaPath } : m
        ));
        resolveMediaPaths([{ ...({ id: inserted.id, mediaPath } as ChatMessage) }]).then(resolved => {
          const signedUrl = resolved[0]?.mediaUrl;
          if (signedUrl) {
            setMessages(prev => prev.map(m =>
              m.id === inserted.id ? { ...m, mediaUrl: signedUrl } : m
            ));
          }
        });
      } else {
        setMessages(prev => prev.map(m =>
          m.id === tempId ? { ...m, id: inserted.id, deliveryStatus: 'sent' } : m
        ));
      }
    } else {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert('Nao foi possivel confirmar o envio da mensagem.');
      setIsSendingMessage(false);
      return;
    }

    setReplyingTo(null);

    // Stop typing indicator
    const allChannels = supabase.getChannels();
    const ch = allChannels.find(c => c.topic === `realtime:chat:${conversationId}`);
    ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
    setIsSendingMessage(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: ChatMessage['type']) => {
    const file = e.target.files?.[0];
    if (file) {
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB
      if (file.size > MAX_SIZE) {
        alert('Arquivo muito grande. Limite máximo: 50MB.');
        e.target.value = '';
        return;
      }
      setShowAttachments(false);
      setMediaPreview({ url: URL.createObjectURL(file), type, file });
      e.target.value = '';
    }
  };

  const confirmSendMedia = () => {
    if (!mediaPreview) return;
    handleSendMessage(inputValue || '', mediaPreview.type, mediaPreview.file, mediaPreview.file.name, undefined, isViewOnce);
    setIsViewOnce(false);
    setMediaPreview(null);
  };

  // ─── Camera ───────────────────────────────────────────────────────────────
  const startCamera = async (facingMode = cameraFacingMode) => {
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      streamRef.current = stream;
      setCameraStream(stream); // state update → triggers useEffect → assigns srcObject after render
      setIsCameraOpen(true);
    } catch {
      alert('Não foi possível acessar a câmera. Verifique as permissões.');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraStream(null);
    setIsCameraOpen(false);
    setIsRecordingVideo(false);
  };

  const takePhoto = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(blob => {
      if (blob) {
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        setMediaPreview({ url: URL.createObjectURL(file), type: 'image', file });
        stopCamera();
      }
    }, 'image/jpeg', 0.9);
  };

  const startVideoRecording = () => {
    if (!streamRef.current) return;
    videoChunksRef.current = [];
    const mimeType = getSupportedVideoMimeType();
    let recorder: MediaRecorder;

    try {
      // iOS Safari is very strict: if we pass an unsupported MIME type it throws.
      // If we pass NO MIME type, it defaults to a proprietary mp4 format.
      recorder = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);
    } catch (err) {
      console.warn('Failed to start MediaRecorder with mimeType, falling back:', err);
      try {
        recorder = new MediaRecorder(streamRef.current);
      } catch (fallbackErr) {
        alert('Gravação de vídeo não suportada neste dispositivo (' + (fallbackErr as Error).message + ').');
        return;
      }
    }

    videoRecorderRef.current = recorder;
    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) {
        videoChunksRef.current.push(e.data);
      }
    };
    recorder.onstop = () => {
      if (videoChunksRef.current.length === 0) {
        alert('Erro ao gravar vídeo: nenhum dado capturado pelo dispositivo.');
        stopCamera();
        return;
      }

      // On iOS Safari, the resulting blob is often video/mp4 even if we didn't specify it
      const actualMimeType = videoChunksRef.current[0]?.type || mimeType || 'video/mp4';
      const cleanMimeType = actualMimeType.split(';')[0];
      const blob = new Blob(videoChunksRef.current, { type: cleanMimeType });

      const ext = cleanMimeType.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `video_${Date.now()}.${ext}`, { type: cleanMimeType });
      setMediaPreview({ url: URL.createObjectURL(file), type: 'video', file });
      stopCamera();
    };

    // Start recording, collecting 1000ms chunks (better for mobile memory than 100ms)
    recorder.start(1000);
    setIsRecordingVideo(true);
  };

  const stopVideoRecording = () => {
    if (videoRecorderRef.current?.state === 'recording') {
      videoRecorderRef.current.stop();
      setIsRecordingVideo(false);
    }
  };

  // ─── Audio ────────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      const mimeType = getSupportedChatAudioMimeType(type => MediaRecorder.isTypeSupported(type));

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const actualMimeType = audioChunksRef.current[0]?.type || mimeType || 'audio/mp4';
        const cleanMimeType = actualMimeType.split(';')[0];
        const ext = getChatAudioExtension(cleanMimeType);
        const blob = new Blob(audioChunksRef.current, { type: cleanMimeType });
        const file = new File([blob], `audio_${Date.now()}.${ext}`, { type: cleanMimeType });
        stream.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        audioContextRef.current?.close();
        await handleSendMessage('', 'audio', file, file.name);
      };
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyser.fftSize = 64;
      const arr = new Uint8Array(analyser.frequencyBinCount);
      const update = () => {
        analyserRef.current?.getByteFrequencyData(arr);
        const step = Math.floor(arr.length / 15);
        setAudioVolumes(Array.from({ length: 15 }, (_, i) => Math.max(10, (arr[i * step] / 255) * 100)));
        animFrameRef.current = requestAnimationFrame(update);
      };
      update();
      recorder.start();
      setIsRecording(true);
      const ch = supabase.getChannels().find(c => c.topic === `realtime:chat:${conversationId}`);
      ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: true });
    } catch { alert('Não foi possível acessar o microfone.'); }
  };

  const stopRecordingAndSend = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      const ch = supabase.getChannels().find(c => c.topic === `realtime:chat:${conversationId}`);
      ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        audioContextRef.current?.close();
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setAudioVolumes(Array(15).fill(10));
      const ch = supabase.getChannels().find(c => c.topic === `realtime:chat:${conversationId}`);
      ch?.track({ userId: myId, name: myName, isTyping: false, isRecordingAudio: false });
    }
  };

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ─── Emoji reactions ──────────────────────────────────────────────────────
  const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  const handleReaction = async (msgId: string, emoji: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg || !myId || isKAI) return;
    const current = msg.reactions ?? {};
    const users: string[] = current[emoji] ?? [];
    const updated = users.includes(myId)
      ? users.filter(u => u !== myId)
      : [...users, myId];
    const newReactions = { ...current, [emoji]: updated };
    // Optimistic local update
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: newReactions } : m));
    setCtxMenu(null);
    // Broadcast to other user instantly (no REPLICA IDENTITY dependency)
    chatChannelRef.current?.send({
      type: 'broadcast',
      event: 'reaction-update',
      payload: { msgId, reactions: newReactions },
    });
    // Persist to DB (so reactions survive page reload)
    await supabase.from('chat_messages').update({ reactions: newReactions }).eq('id', msgId);
  };

  // ─── Delete message ───────────────────────────────────────────────────────

  // Apagar para mim: adiciona myId ao array deleted_for — a mensagem some só para o usuário atual
  const handleDeleteForMe = (msg: ChatMessage) => {
    requestConfirm({
      title: 'Apagar mensagem',
      message: 'Tem certeza que deseja apagar esta mensagem? Ela será removida apenas para você.',
      confirmLabel: 'Apagar',
      onConfirm: async () => {
        const updated = [...(msg.deleted_for ?? []), myId];
        setMessages(prev => prev.filter(m => m.id !== msg.id));
        setCtxMenu(null);
        await supabase.from('chat_messages').update({ deleted_for: updated }).eq('id', msg.id);
      },
    });
  };

  const handleDeleteForAll = (msgId: string) => {
    requestConfirm({
      title: 'Apagar para todos',
      message: 'Tem certeza? A mensagem será removida para todos os participantes. Esta ação não poderá ser desfeita.',
      confirmLabel: 'Apagar para todos',
      onConfirm: async () => {
        setMessages(prev => prev.map(m =>
          m.id === msgId ? { ...m, is_deleted: true, text: undefined } : m
        ));
        setCtxMenu(null);
        await supabase.from('chat_messages')
          .update({ is_deleted: true, content: null, media_url: null })
          .eq('id', msgId);
      },
    });
  };

  // ─── Long press / right-click for context menu ────────────────────────────
  const handleMsgTouchStart = (e: React.TouchEvent, msg: ChatMessage) => {
    const touch = e.touches[0];
    pressTimer.current = setTimeout(() => {
      setCtxMenu({ msg, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  const handleMsgTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  const handleMsgRightClick = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    setCtxMenu({ msg, x: e.clientX, y: e.clientY });
  };

  if (!chatUser) return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="animate-spin text-gold-500" size={32} />
    </div>
  );

  const isTypingVisible = recordingUser || typingUser || isKaiTyping;
  const activityLabel = recordingUser
    ? `${recordingUser} está gravando áudio...`
    : isKaiTyping
      ? 'KAI está digitando...'
      : typingUser
        ? `${typingUser} está digitando...`
        : '';
  return (
    <div className="flex flex-col h-screen bg-card-bg dark:bg-[#0b141a]">
      {/* Header */}
      <ChatDetailHeader
        name={chatUser.name}
        role={chatUser.role}
        avatarUrl={chatUser.isAI ? null : (chatUser.avatar ?? null)}
        otherId={id ?? ''}
        isKAI={isKAI}
        isOnline={isKAI ? true : isOtherOnline}
        onBack={() => navigate(-1)}
        onMore={() => { setShowSearch(s => !s); setSearchQuery(''); }}
      />

      {/* Search bar */}
      {showSearch && (
        <div className="bg-card-bg px-4 pb-2">
          <input
            autoFocus
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar na conversa..."
            className="w-full bg-surface-50 dark:bg-surface-200 rounded-xl px-4 py-2 text-sm text-text-primary placeholder:text-text-secondary outline-none"
          />
        </div>
      )}

      {/* KAI client context banner */}
      {isKAI && clientContext && (
        <div className="bg-gold-500/10 border-b border-gold-500/20 px-4 py-1.5 flex items-center gap-2">
          <Bot size={12} className="text-gold-600 flex-shrink-0" />
          <span className="text-xs text-gold-700 dark:text-gold-400 truncate">
            KAI no contexto de <strong>{clientContext.name}</strong>
          </span>
        </div>
      )}

      {/* Typing indicator banner */}
      {isTypingVisible && (
        <div className="bg-card-bg border-b border-surface-100 px-4 py-1 flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 150, 300].map(d => (
              <span key={d} className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
          <span className="text-xs text-emerald-600 font-medium animate-pulse">{activityLabel}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#ECE5DD] dark:bg-[#0b141a]">
        {/* Load more button */}
        {hasMore && (
          <div className="flex justify-center">
            <button
              onClick={loadMoreMessages}
              disabled={isLoadingMore}
              className="text-xs text-gold-600 dark:text-gold-400 bg-card-bg/80 dark:bg-black/30 px-4 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              {isLoadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
              Carregar mensagens anteriores
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {isKAI ? (
              <>
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center mb-4 shadow-lg">
                  <Bot className="text-white" size={40} />
                </div>
                <p className="font-semibold text-text-primary">Olá! Sou o KAI 👋</p>
                <p className="text-sm mt-1 max-w-xs text-text-secondary opacity-70">Me conte sobre um cliente e vou analisar o perfil de financiamento.</p>
              </>
            ) : (
              <p className="text-sm text-text-secondary opacity-60">Nenhuma mensagem. Diga olá! 👋</p>
            )}
          </div>
        )}

        {(searchQuery
          ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
          : messages
        ).map(msg => {
          const isMediaOnly = ['image', 'video'].includes(msg.type) && !msg.text && !msg.viewOnce;
          // View once states
          const isViewOnceMsg = msg.viewOnce;
          const isViewOnceViewed = isViewOnceMsg && (msg.isLocked || msg.viewedAt);
          const isViewOncePending = isViewOnceMsg && !msg.isMe && !isViewOnceViewed;
          // Reply parent
          const parentMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
          // Reactions
          const reactionEntries = Object.entries(msg.reactions ?? {}).filter(([, users]) => users.length > 0);

          return (
            <div key={msg.id} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] relative shadow-sm ${msg.isMe
                  ? 'bg-[#D9FDD3] dark:bg-[#005c4b] text-text-primary dark:text-white rounded-2xl rounded-tr-none'
                  : 'bg-card-bg dark:bg-[#202c33] text-text-primary dark:text-white rounded-2xl rounded-tl-none'
                } ${isMediaOnly ? 'p-1 pb-6' : 'p-3'}`}
                onTouchStart={e => handleMsgTouchStart(e, msg)}
                onTouchEnd={handleMsgTouchEnd}
                onTouchMove={handleMsgTouchEnd}
                onContextMenu={e => handleMsgRightClick(e, msg)}
              >

                {/* ── DELETED FOR ALL placeholder ── */}
                {msg.is_deleted && (
                  <div className="flex items-center gap-2 text-text-secondary italic py-0.5">
                    <Trash2 size={13} className="opacity-50 flex-shrink-0" />
                    <span className="text-sm">Esta mensagem foi apagada</span>
                  </div>
                )}

                {/* ── REPLY QUOTE ── */}
                {!msg.is_deleted && parentMsg && (
                  <div className="border-l-2 border-gold-500 pl-2 bg-black/5 dark:bg-card-bg/5 rounded-r-lg p-1.5 mb-2">
                    <span className="text-[11px] font-semibold block text-gold-600 dark:text-gold-400">
                      {parentMsg.isMe ? 'Você' : chatUser?.name}
                    </span>
                    <span className="text-xs text-text-secondary truncate block">
                      {parentMsg.text || (parentMsg.type === 'image' ? '📷 Imagem' : parentMsg.type === 'audio' ? '🎤 Áudio' : '📎 Arquivo')}
                    </span>
                  </div>
                )}

                {/* ── VIEW ONCE badge for sender ── */}
                {isViewOnceMsg && msg.isMe && (
                  <div className="flex items-center gap-2 text-xs text-text-secondary italic mb-1">
                    <Eye size={12} />
                    <span>Visualização única – enviado</span>
                  </div>
                )}

                {/* ── VIEW ONCE: locked / viewed state ── */}
                {isViewOnceViewed && !msg.isMe && (
                  <div className="flex items-center gap-2 p-3 text-text-secondary">
                    <EyeOff size={18} />
                    <span className="text-sm italic">Mensagem visualizada</span>
                  </div>
                )}

                {/* ── VIEW ONCE: pending tap to open ── */}
                {isViewOncePending && (
                  <ViewOnceCard
                    msg={msg}
                    onOpen={() => msg.type === 'text'
                      ? setViewOnceTextMsgId(msg.id)
                      : setViewOnceModalMsgId(msg.id)
                    }
                  />
                )}

                {/* ── Regular media (non view-once) ── */}
                {!isViewOnceMsg && msg.type === 'image' && msg.mediaUrl && (
                  <div
                    className={`overflow-hidden cursor-pointer ${isMediaOnly ? 'rounded-2xl' : 'rounded-xl mb-1.5'}`}
                    onClick={() => setFullscreenMedia({ url: msg.mediaUrl!, type: 'image', name: msg.fileName })}
                  >
                    <img
                      src={msg.mediaUrl}
                      alt=""
                      className="w-full max-h-64 object-cover"
                    />
                  </div>
                )}
                {!isViewOnceMsg && msg.type === 'video' && msg.mediaUrl && (
                  <div
                    className={`relative overflow-hidden cursor-pointer group ${isMediaOnly ? 'rounded-2xl' : 'rounded-xl mb-1.5'}`}
                    onClick={() => setFullscreenMedia({ url: msg.mediaUrl!, type: 'video', name: msg.fileName })}
                  >
                    <video
                      src={msg.mediaUrl}
                      className="w-full max-h-64 object-cover"
                      playsInline
                      muted
                    />
                    {/* Play overlay — Instagram style */}
                    <div className="absolute inset-0 bg-black/25 flex items-center justify-center group-hover:bg-black/35 transition-colors">
                      <div className="w-11 h-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
                        <Play size={20} className="text-white fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>
                )}
                {msg.type === 'audio' && msg.mediaUrl && (
                  <AudioMessage url={msg.mediaUrl} isMe={msg.isMe} />
                )}
                {!isViewOnceMsg && msg.type === 'document' && msg.mediaUrl && (
                  <div className="flex items-center gap-3 bg-black/5 dark:bg-card-bg/10 p-3 rounded-xl mb-2 cursor-pointer"
                    onClick={() => setFullscreenMedia({ url: msg.mediaUrl!, type: 'document', name: msg.fileName })}>
                    <FileText size={24} className="text-red-500 flex-shrink-0" />
                    <span className="text-sm truncate max-w-[150px] font-medium">{msg.fileName || 'Documento'}</span>
                  </div>
                )}
                {msg.text && !isViewOnceMsg && (
                  <div className={`text-sm leading-relaxed ${['image', 'video'].includes(msg.type) ? 'px-1 pt-1' : ''}`}>
                    {msg.senderId === 'kai-agent'
                      ? <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{msg.text}</ReactMarkdown>
                      : msg.text}
                  </div>
                )}
                <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${isMediaOnly
                  ? 'absolute bottom-1.5 right-2 text-white/95 drop-shadow-md bg-black/40 px-2 py-0.5 rounded-full backdrop-blur-sm'
                  : msg.isMe ? 'text-green-800/80 dark:text-white/60' : 'text-text-secondary dark:text-text-secondary'
                  }`}>
                  <span>{msg.timestamp}</span>
                  {msg.isMe && !isKAI && (
                    msg.deliveryStatus === 'sending'
                      ? <Check size={11} className="opacity-50 flex-shrink-0" />
                      : isOtherOnline
                        ? <CheckCheck size={11} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                        : <CheckCheck size={11} className="opacity-50 flex-shrink-0" />
                  )}
                </div>
                {/* Reaction row */}
                {reactionEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {reactionEntries.map(([emoji, users]) => (
                      <button
                        key={emoji}
                        onClick={e => { e.stopPropagation(); handleReaction(msg.id, emoji); }}
                        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                          users.includes(myId)
                            ? 'bg-gold-500/20 border-gold-500/40 text-gold-700 dark:text-gold-400'
                            : 'bg-black/5 dark:bg-card-bg/10 border-black/10 dark:border-white/10 text-text-secondary'
                        }`}
                      >
                        {emoji}{users.length > 1 && <span className="ml-0.5">{users.length}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isTypingVisible && (
          <div className="flex justify-start">
            <div className="bg-card-bg dark:bg-[#202c33] rounded-lg rounded-tl-none px-4 py-3 shadow-sm flex items-center gap-2">
              <div className="flex gap-1">
                {[0, 150, 300].map(d => (
                  <span key={d} className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
              <span className="text-xs text-text-secondary ml-1">{activityLabel}</span>
            </div>
          </div>
        )}

        {isUploading && (
          <div className="flex justify-end">
            <div className="bg-[#D9FDD3] rounded-lg p-3 flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 size={16} className="animate-spin" /> Enviando arquivo...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview banner */}
      {replyingTo && (
        <div className="bg-card-bg border-t border-surface-100 px-4 py-2 flex items-center gap-2">
          <CornerUpLeft size={14} className="text-gold-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-gold-600 dark:text-gold-400">
              {replyingTo.isMe ? 'Você' : chatUser?.name}
            </p>
            <p className="text-xs text-text-secondary truncate">
              {replyingTo.text || (replyingTo.type === 'image' ? '📷 Imagem' : '🎤 Áudio')}
            </p>
          </div>
          <button onClick={() => setReplyingTo(null)} className="p-1 text-text-secondary">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="bg-card-bg p-2 flex items-end gap-2 sticky bottom-0 z-20 pb-safe relative">
        <AnimatePresence>
          {showAttachments && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-16 left-4 bg-card-bg rounded-xl shadow-xl p-4 grid grid-cols-3 gap-4 border border-surface-200 z-30">
              <button onClick={() => docInputRef.current?.click()} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-purple-500 flex items-center justify-center text-white shadow-lg"><FileText size={20} /></div>
                <span className="text-xs font-medium text-text-secondary">Arquivo</span>
              </button>
              <button onClick={() => imageInputRef.current?.click()} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-pink-500 flex items-center justify-center text-white shadow-lg"><ImageIcon size={20} /></div>
                <span className="text-xs font-medium text-text-secondary">Galeria</span>
              </button>
              <button onClick={() => { setShowAttachments(false); startCamera(); }} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white shadow-lg"><Camera size={20} /></div>
                <span className="text-xs font-medium text-text-secondary">Câmera</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Arquivo: somente PDF */}
        <input type="file" ref={docInputRef} className="hidden" accept=".pdf,application/pdf" onChange={e => handleFileUpload(e, 'document')} />
        {/* Galeria: fototeca (imagens e vídeos do dispositivo, sem câmera) */}
        <input type="file" ref={imageInputRef} className="hidden"
          accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(e, file.type.startsWith('video/') ? 'video' : 'image');
          }} />

        <button onClick={() => setShowAttachments(!showAttachments)} className="p-3 text-text-secondary hover:text-text-primary">
          {showAttachments ? <X size={24} /> : <Plus size={24} />}
        </button>

        {isRecording ? (
          <div className="flex-1 bg-surface-50 dark:bg-surface-200 rounded-2xl px-3 py-2 flex items-center gap-2">
            {/* Red dot + timer */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-medium tabular-nums text-text-secondary w-8">
                {`${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, '0')}`}
              </span>
            </div>
            {/* Wave bars */}
            <div className="flex items-center gap-[2px] h-7 flex-1 justify-center">
              {audioVolumes.map((vol, i) => (
                <div
                  key={i}
                  className="w-[3px] bg-gold-400 rounded-full transition-all duration-75"
                  style={{ height: `${Math.max(15, vol)}%` }}
                />
              ))}
            </div>
            {/* Cancel */}
            <button onClick={cancelRecording} className="text-text-secondary hover:text-red-500 p-1 transition-colors flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className={`flex-1 bg-surface-50 dark:bg-surface-200 rounded-2xl px-4 py-2 flex items-center gap-2 ${isViewOnce ? 'ring-1 ring-gold-500/40' : ''}`}>
            {isViewOnce && (
              <Lock size={14} className="text-gold-500 flex-shrink-0" />
            )}
            <textarea
              rows={1}
              value={inputValue}
              onChange={e => handleInputChange(e.target.value)}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (isSendingMessage) return;
                  handleSendMessage();
                }
              }}
              placeholder={isViewOnce ? 'Mensagem de visualização única...' : 'Mensagem'}
              className="flex-1 bg-transparent border-none outline-none text-text-primary placeholder:text-text-secondary resize-none min-h-[24px] max-h-[120px] overflow-y-auto leading-6"
            />
            {!isKAI && (
              <button
                onClick={() => setIsViewOnce(v => !v)}
                className={`p-1 rounded-full transition-colors flex-shrink-0 ${isViewOnce ? 'text-gold-500' : 'text-text-secondary opacity-40 hover:opacity-80'}`}
                title={isViewOnce ? 'Desativar Visualização Única' : 'Ativar Visualização Única'}
              >
                <Eye size={16} />
              </button>
            )}
          </div>
        )}

        <button
          onClick={inputValue ? () => handleSendMessage() : (isRecording ? stopRecordingAndSend : startRecording)}
          disabled={isSendingMessage}
          className="p-3 rounded-full shadow-md bg-gold-500 text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {inputValue || isRecording ? <Send size={20} /> : <Mic size={20} />}
        </button>
      </div>

      {/* Camera Modal */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black flex flex-col">
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between z-10 bg-gradient-to-b from-black/50 to-transparent">
              <button onClick={stopCamera} className="text-white p-2 rounded-full hover:bg-card-bg/20"><X size={28} /></button>
              <button onClick={() => { const m = cameraFacingMode === 'user' ? 'environment' : 'user'; setCameraFacingMode(m); startCamera(m); }}
                className="text-white p-2 rounded-full hover:bg-card-bg/20"><SwitchCamera size={28} /></button>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted={!isRecordingVideo} className="w-full h-full object-cover" />
              {isRecordingVideo && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-500 text-white px-3 py-1 rounded-full text-sm animate-pulse">
                  <div className="w-2 h-2 bg-card-bg rounded-full" /> Gravando
                </div>
              )}
            </div>
            {/* Buttons - pushed up well above tab bar */}
            <div className="absolute bottom-0 left-0 right-0 pt-12 pb-28 flex justify-center gap-16 bg-gradient-to-t from-black/90 to-transparent">
              <div className="flex flex-col items-center gap-2">
                <button onClick={takePhoto} disabled={isRecordingVideo}
                  className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-50">
                  <div className="w-12 h-12 bg-card-bg rounded-full" />
                </button>
                <span className="text-white text-xs font-medium">Foto</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button onClick={isRecordingVideo ? stopVideoRecording : startVideoRecording}
                  className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center">
                  {isRecordingVideo
                    ? <Square size={28} className="text-red-500 fill-red-500" />
                    : <Circle size={28} className="text-red-500 fill-red-500" />}
                </button>
                <span className="text-white text-xs font-medium">{isRecordingVideo ? 'Parar' : 'Vídeo'}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media Preview */}
      <AnimatePresence>
        {mediaPreview && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[250] bg-black/95 flex flex-col">
            <div className="flex items-center justify-between p-4 text-white">
              <button onClick={() => { setMediaPreview(null); setIsViewOnce(false); }} className="p-2 hover:bg-card-bg/10 rounded-full"><X size={24} /></button>
              <span className="text-sm font-medium">Pré-visualização</span>
              <div className="w-10" />
            </div>
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
              {mediaPreview.type === 'image' && (
                <img src={mediaPreview.url} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
              )}
              {mediaPreview.type === 'video' && (
                <video src={mediaPreview.url} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg" />
              )}
              {mediaPreview.type === 'document' && (
                <div className="flex flex-col items-center gap-4 text-white">
                  <FileText size={64} className="text-red-500" />
                  <p className="text-lg font-medium text-center">{mediaPreview.file.name}</p>
                </div>
              )}
            </div>
            {/* View Once toggle + send bar */}
            <div className="p-4 bg-black/60 flex flex-col gap-2">
              {['image', 'video', 'document'].includes(mediaPreview.type) && (
                <button
                  onClick={() => setIsViewOnce(v => !v)}
                  className={`flex items-center gap-2 self-center px-4 py-2 rounded-full border text-sm font-medium transition-colors ${isViewOnce
                    ? 'bg-gold-500 border-gold-500 text-white'
                    : 'bg-card-bg/10 border-white/20 text-white/70'
                    }`}
                >
                  {isViewOnce ? <Lock size={14} /> : <Eye size={14} />}
                  {isViewOnce ? 'Visualização Única ativada' : 'Ativar Visualização Única'}
                </button>
              )}
              <div className="flex items-center gap-2">
                <input value={inputValue} onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmSendMedia()}
                  placeholder="Adicionar legenda..."
                  className="flex-1 bg-card-bg/10 text-white placeholder:text-white/50 border-none outline-none rounded-full px-4 py-3" />
                <button onClick={confirmSendMedia}
                  className="bg-gold-500 text-white p-3 rounded-full flex items-center justify-center">
                  <Send size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      {ctxMenu && (
        <div
          className="fixed z-[400] bg-card-bg rounded-2xl shadow-2xl border border-surface-100 overflow-hidden min-w-[180px]"
          style={{ top: Math.min(ctxMenu.y, window.innerHeight - 260), left: Math.min(ctxMenu.x, window.innerWidth - 200) }}
          onClick={e => e.stopPropagation()}
        >
          {/* Emoji reactions */}
          <div className="flex justify-around px-3 py-3 border-b border-surface-100">
            {EMOJI_LIST.map(emoji => (
              <button
                key={emoji}
                onClick={() => handleReaction(ctxMenu.msg.id, emoji)}
                className="text-xl hover:scale-125 transition-transform active:scale-110"
              >
                {emoji}
              </button>
            ))}
          </div>
          {/* Actions */}
          <button
            onClick={() => { setReplyingTo(ctxMenu.msg); setCtxMenu(null); }}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-text-primary hover:bg-surface-50 transition-colors"
          >
            <CornerUpLeft size={16} className="text-text-secondary" /> Responder
          </button>
          {ctxMenu.msg.text && (
            <button
              onClick={() => { navigator.clipboard.writeText(ctxMenu.msg.text!); setCtxMenu(null); }}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-text-primary hover:bg-surface-50 transition-colors"
            >
              <Copy size={16} className="text-text-secondary" /> Copiar texto
            </button>
          )}
          <button
            onClick={() => handleDeleteForMe(ctxMenu.msg)}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 size={16} /> Apagar para mim
          </button>
          {ctxMenu.msg.isMe && (
            <button
              onClick={() => handleDeleteForAll(ctxMenu.msg.id)}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-t border-surface-100"
            >
              <Trash2 size={16} /> Apagar para todos
            </button>
          )}
        </div>
      )}

      {/* View Once Text Modal */}
      {viewOnceTextMsgId && (() => {
        const msg = messages.find(m => m.id === viewOnceTextMsgId);
        if (!msg) return null;
        const closeTextModal = () => {
          setViewOnceTextMsgId(null);
          setMessages(prev => prev.map(m =>
            m.id === viewOnceTextMsgId ? { ...m, isLocked: true, viewedAt: new Date().toISOString() } : m
          ));
          supabase.from('chat_messages')
            .update({ is_locked: true, viewed_at: new Date().toISOString() })
            .eq('id', viewOnceTextMsgId);
        };
        return (
          <div
            className="fixed inset-0 z-[300] bg-black/90 flex flex-col"
            onClick={closeTextModal}
          >
            <div className="flex items-center justify-between p-4 text-white">
              <button onClick={closeTextModal} className="p-2 hover:bg-card-bg/10 rounded-full">
                <X size={24} />
              </button>
              <span className="text-sm font-medium flex items-center gap-1.5">
                <Eye size={14} /> Visualização Única
              </span>
              <div className="w-10" />
            </div>
            <div
              className="flex-1 flex items-center justify-center p-8"
              onClick={e => e.stopPropagation()}
            >
              <div className="bg-card-bg dark:bg-[#202c33] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                <p className="text-text-primary text-base leading-relaxed">{msg.text}</p>
              </div>
            </div>
            <div className="p-4 text-center">
              <p className="text-white/50 text-xs">Toque fora para fechar — a mensagem desaparecerá</p>
            </div>
          </div>
        );
      })()}

      {/* View Once Modal */}
      {viewOnceModalMsgId && (() => {
        const msg = messages.find(m => m.id === viewOnceModalMsgId);
        if (!msg) return null;
        return (
          <ViewOnceModal
            messageId={viewOnceModalMsgId}
            type={msg.type}
            onClose={() => {
              setViewOnceModalMsgId(null);
              // Update local state so the message immediately shows as viewed
              setMessages(prev => prev.map(m =>
                m.id === viewOnceModalMsgId ? { ...m, isLocked: true, viewedAt: new Date().toISOString() } : m
              ));
            }}
          />
        );
      })()}

      {/* Fullscreen Media */}
      <AnimatePresence>
        {fullscreenMedia && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/95 flex flex-col">
            <div className="flex items-center justify-between p-4 text-white">
              <button onClick={() => setFullscreenMedia(null)} className="p-2 hover:bg-card-bg/10 rounded-full"><X size={24} /></button>
              <span className="text-sm font-medium truncate max-w-[200px]">{fullscreenMedia.name || 'Mídia'}</span>
              <button onClick={() => handleDownload(fullscreenMedia.url, fullscreenMedia.name || 'download')}
                className="p-2 hover:bg-card-bg/10 rounded-full"><Download size={24} /></button>
            </div>
            <div className="flex-1 flex items-center justify-center p-4">
              {fullscreenMedia.type === 'image' && <img src={fullscreenMedia.url} alt="" className="max-w-full max-h-full object-contain rounded-lg" />}
              {fullscreenMedia.type === 'video' && <video src={fullscreenMedia.url} controls autoPlay playsInline className="max-w-full max-h-full rounded-lg" />}
              {fullscreenMedia.type === 'document' && (
                <div className="flex flex-col items-center gap-4 text-white">
                  <FileText size={64} className="text-red-500" />
                  <p className="text-lg font-medium">{fullscreenMedia.name}</p>
                  <button onClick={() => handleDownload(fullscreenMedia.url, fullscreenMedia.name || 'doc.pdf')}
                    className="px-6 py-3 bg-gold-500 text-white rounded-full font-medium flex items-center gap-2">
                    <Download size={20} /> Baixar
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
