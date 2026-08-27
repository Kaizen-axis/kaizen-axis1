// src/components/chat/ChatDetailPanel.tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { sendMessageToKai } from '@/services/kaiAgent';
import { ChatDetailHeader } from './ChatDetailHeader';
import { ChatMessageBubble, BubbleMessage } from './ChatMessageBubble';
import { ChatInputBar } from './ChatInputBar';
import { ChatWelcome } from './ChatWelcome';
import { ChatInfoModal, ChatProfileInfo, ChatGroupInfo } from './ChatInfoModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { withInferredMime } from '@/lib/client-document-upload';
import { getChatAudioExtension } from '@/lib/chat-audio';

interface ChatDetailPanelProps {
  otherId: string | null;
  otherName: string;
  otherRole?: string;
  otherAvatar?: string | null;
  isKAI?: boolean;
  isGroup?: boolean;
  isOnline?: boolean;
  onClose?: () => void;
  onLeftGroup?: (groupId: string) => void;
}

const PAGE_SIZE = 50;
// TTL para display temporário (optimistic). O path é armazenado em media_path no DB
// e URLs curtas são geradas a cada carregamento (C-01).
const SIGNED_URL_TTL = 3600; // 1 hora

// Extrai o path de uma URL pública do chat-media (bucket era público antes de 2026-05-14)
function extractPublicChatMediaPath(url: string): string | null {
  const marker = '/object/public/chat-media/';
  const idx = url.indexOf(marker);
  return idx !== -1 ? url.slice(idx + marker.length) : null;
}

async function resolveMediaUrls(msgs: BubbleMessage[]): Promise<BubbleMessage[]> {
  // Resolve: (a) old public URLs, (b) raw storage paths from media_path (C-01)
  // P1-01: uses get-chat-media-url Edge Function (validates conversation membership server-side)
  const needConversion = msgs.filter(m => {
    if (!m.mediaUrl && !m.mediaPath) return false;
    // P1-03: skip view-once messages not yet opened — file is in chat-media-private
    // (no SELECT policy for authenticated users; URL is served via generate-view-once-url)
    if (m.viewOnce && !m.viewOnceOpened) return false;
    // Has raw storage path → always generate fresh URL
    if (m.mediaPath) return true;
    // Old public URL pattern → convert
    if (m.mediaUrl?.includes('/object/public/chat-media/')) return true;
    return false;
  });
  if (needConversion.length === 0) return msgs;

  const resolved = await Promise.all(
    needConversion.map(async m => {
      // Prefer mediaPath for fresh URL generation (C-01)
      let storagePath: string | null = m.mediaPath ?? null;
      if (!storagePath && m.mediaUrl?.includes('/object/public/chat-media/')) {
        storagePath = extractPublicChatMediaPath(m.mediaUrl);
      }
      if (!storagePath) return { id: m.id, signedUrl: m.mediaUrl! };
      // P1-01: validate via Edge Function — no direct createSignedUrl from frontend
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
}

export function ChatDetailPanel({
  otherId, otherName, otherRole, otherAvatar, isKAI, isGroup, isOnline, onClose, onLeftGroup,
}: ChatDetailPanelProps) {
  const { user, profile, allProfiles } = useApp();
  const { markConversationRead } = useChatUnread();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const myId = user?.id;
  const myName = profile?.chat_display_name || profile?.name || user?.email || 'Usuario';

  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [remoteActivity, setRemoteActivity] = useState<{ name: string; type: 'typing' | 'recording' } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [userInfo, setUserInfo] = useState<ChatProfileInfo | null>(null);
  const [groupInfo, setGroupInfo] = useState<ChatGroupInfo | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);
  const [leavingGroup, setLeavingGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupId = isGroup && otherId ? otherId.replace('group-', '') : null;

  const conversationId = isKAI
    ? `kai-${myId}`
    : isGroup
      ? otherId
      : otherId && myId
        ? [myId, otherId].sort().join('-')
        : null;

  const availableGroupMembers = useMemo<ChatProfileInfo[]>(() => {
    if (!groupInfo || !myId) return [];
    const currentMemberIds = new Set(groupInfo.members.map(member => member.id));
    return (allProfiles ?? [])
      .filter(member => member.id && member.id !== myId && !currentMemberIds.has(member.id))
      .map(member => ({
        id: member.id,
        name: member.name,
        role: member.role,
        avatar_url: member.avatar_url,
        chat_display_name: member.chat_display_name,
        chat_avatar_url: member.chat_avatar_url,
        chat_status_text: member.chat_status_text,
        chat_availability: member.chat_availability,
      }))
      .sort((a, b) => (a.chat_display_name || a.name || '').localeCompare(b.chat_display_name || b.name || ''));
  }, [allProfiles, groupInfo, myId]);

  const mapMsg = useCallback((m: any): BubbleMessage => ({
    id: m.id,
    text: m.content,
    type: m.type === 'kai_reply' ? 'text' : m.type as BubbleMessage['type'],
    mediaUrl: m.media_url,
    mediaPath: m.media_path ?? undefined,   // used by resolveMediaUrls (C-01)
    fileName: m.file_name,
    timestamp: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date(m.created_at).toLocaleDateString(),
    isMe: m.sender_id === myId && m.type !== 'kai_reply',
    isKAI: isKAI && m.type === 'kai_reply',
    deliveryStatus: 'sent' as const,
    is_deleted: m.is_deleted ?? false,
    reactions: [],
    viewOnce: m.view_once ?? false,
    viewOnceOpened: m.view_once_opened ?? false,
  }), [myId, isKAI]);

  const loadReactions = useCallback(async (msgs: BubbleMessage[]) => {
    if (msgs.length === 0) return msgs;
    const ids = msgs.map(m => m.id);
    const { data, error } = await supabase
      .from('chat_message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', ids);

    if (error) {
      console.error('[loadReactions]', error.message);
      return msgs;
    }

    const byMsg: Record<string, { emoji: string; count: number; reacted: boolean }[]> = {};
    for (const r of (data ?? [])) {
      if (!byMsg[r.message_id]) byMsg[r.message_id] = [];
      const existing = byMsg[r.message_id].find(x => x.emoji === r.emoji);
      if (existing) {
        existing.count++;
        if (r.user_id === myId) existing.reacted = true;
      } else {
        byMsg[r.message_id].push({ emoji: r.emoji, count: 1, reacted: r.user_id === myId });
      }
    }
    return msgs.map(m => ({ ...m, reactions: byMsg[m.id] ?? [] }));
  }, [myId]);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .not('deleted_for', 'cs', `{"${myId}"}`)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);
    const msgs = (data ?? []).map(mapMsg).reverse();
    const withReactions = await loadReactions(msgs);
    const withMedia = await resolveMediaUrls(withReactions);
    setMessages(withMedia);
    setLoading(false);
  }, [conversationId, myId, mapMsg, loadReactions]);

  useEffect(() => {
    if (conversationId) markConversationRead(conversationId);
  }, [conversationId, markConversationRead]);

  useEffect(() => {
    if (!conversationId || !myId) {
      setMessages([]);
      return;
    }
    setMessages([]);
    loadMessages();
    if (isKAI) return; // KAI responses are added directly after send, no realtime needed
    const channel = supabase
      .channel(`panel:${conversationId}`, { config: { broadcast: { self: false } } })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (p) => {
        const m = p.new as any;
        const isFromOther = isGroup
          ? m.sender_id !== myId
          : (m.sender_id !== myId && m.receiver_id === myId);
        if (isFromOther) {
          // Resolve media URL via Edge Function so recipient sees the image immediately
          const mapped = mapMsg(m);
          resolveMediaUrls([mapped]).then(resolved => {
            setMessages(prev => [...prev, resolved[0]]);
          });
          markConversationRead(conversationId);
        }
      })
      .on('broadcast', { event: 'chat-activity' }, ({ payload }) => {
        // A-06: validate payload shape and restrict allowed activity types
        if (!payload || typeof payload.userId !== 'string' || payload.userId === myId) return;
        const allowedTypes = ['typing', 'recording', 'idle'] as const;
        if (!allowedTypes.includes(payload.type)) return;
        // Sanitize name: only use the known otherName, never trust payload.name
        if (payload.type === 'typing' || payload.type === 'recording') {
          setRemoteActivity({ name: otherName || 'Usuario', type: payload.type });
          if (remoteActivityTimeoutRef.current) clearTimeout(remoteActivityTimeoutRef.current);
          remoteActivityTimeoutRef.current = setTimeout(() => setRemoteActivity(null), payload.type === 'recording' ? 6000 : 2500);
        } else if (payload.type === 'idle') {
          setRemoteActivity(null);
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'chat-activity',
        payload: { userId: myId, name: myName, type: 'idle' },
      });
      channelRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (remoteActivityTimeoutRef.current) clearTimeout(remoteActivityTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [conversationId, myId, myName, otherName, isKAI, isGroup, loadMessages, mapMsg, markConversationRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
      channelRef.current?.send({
        type: 'broadcast',
        event: 'chat-activity',
        payload: { userId: myId, name: myName, type: 'idle' },
      });
    };
  }, [myId, myName]);

  const sendActivity = useCallback((type: 'typing' | 'recording' | 'idle') => {
    if (!myId || isKAI) return;
    channelRef.current?.send({
      type: 'broadcast',
      event: 'chat-activity',
      payload: { userId: myId, name: myName, type },
    });
  }, [isKAI, myId, myName]);

  const handleTypingChange = useCallback((isTyping: boolean) => {
    if (isTyping) {
      sendActivity('typing');
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => sendActivity('idle'), 1800);
    } else {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      sendActivity('idle');
    }
  }, [sendActivity]);

  const handleRecordingChange = useCallback((isRecordingAudio: boolean) => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendActivity(isRecordingAudio ? 'recording' : 'idle');
  }, [sendActivity]);

  const openInfo = useCallback(async () => {
    if (!otherId || isKAI) return;
    setShowInfo(true);
    setInfoLoading(true);
    setUserInfo(null);
    setGroupInfo(null);

    if (isGroup && groupId) {
      const [{ data: group }, { data: members }] = await Promise.all([
        supabase
          .from('chat_groups')
          .select('id, name, avatar_url, created_by')
          .eq('id', groupId)
          .maybeSingle(),
        supabase
          .from('chat_group_members')
          .select('user_id, profiles:user_id(id, name, role, avatar_url, chat_display_name, chat_avatar_url, chat_status_text, chat_availability)')
          .eq('group_id', groupId),
      ]);

      const memberProfiles = (members || [])
        .map((row: any) => row.profiles)
        .filter(Boolean) as ChatProfileInfo[];

      setGroupInfo({
        id: group?.id || groupId,
        name: group?.name || otherName || 'Grupo',
        avatar_url: group?.avatar_url || null,
        created_by: group?.created_by || null,
        members: memberProfiles,
      });
      setInfoLoading(false);
      return;
    }

    const { data } = await supabase
      .from('profiles')
      .select('id, name, role, avatar_url, chat_display_name, chat_avatar_url, chat_status_text, chat_availability')
      .eq('id', otherId)
      .maybeSingle();

    setUserInfo((data as ChatProfileInfo | null) || {
      id: otherId,
      name: otherName,
      role: otherRole,
      avatar_url: otherAvatar || null,
    });
    setInfoLoading(false);
  }, [groupId, isGroup, isKAI, otherAvatar, otherId, otherName, otherRole]);

  const handleRemoveGroupMember = useCallback((memberId: string) => {
    if (!groupId || !myId || memberId === myId) return;

    const member = groupInfo?.members.find(candidate => candidate.id === memberId);
    const memberName = member?.chat_display_name || member?.name || 'este membro';

    requestConfirm({
      title: 'Remover do grupo',
      message: `Tem certeza que deseja remover ${memberName} do grupo?`,
      confirmLabel: 'Remover',
      onConfirm: async () => {
        const { data: freshGroup } = await supabase
          .from('chat_groups').select('created_by').eq('id', groupId).maybeSingle();
        if (!freshGroup || freshGroup.created_by !== myId) return;

        setRemovingMemberId(memberId);
        const { error } = await supabase
          .from('chat_group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', memberId);

        if (error) {
          alert('Erro ao remover participante do grupo.');
          setRemovingMemberId(null);
          return;
        }

        setGroupInfo(prev => prev
          ? { ...prev, members: prev.members.filter(m => m.id !== memberId) }
          : prev
        );
        setRemovingMemberId(null);
      },
    });
  }, [groupId, groupInfo?.members, myId, requestConfirm]);

  const handleAddGroupMember = useCallback(async (memberId: string) => {
    if (!groupId || !myId || groupInfo?.created_by !== myId || groupInfo.members.some(member => member.id === memberId)) return;
    const member = availableGroupMembers.find(candidate => candidate.id === memberId);
    if (!member) return;

    setAddingMemberId(memberId);
    const { error } = await supabase
      .from('chat_group_members')
      .insert({ group_id: groupId, user_id: memberId });

    if (error) {
      alert('Erro ao adicionar participante ao grupo.');
      setAddingMemberId(null);
      return;
    }

    // A-09: strip newlines/control chars from user-supplied names before inserting
    const safeName = myName.replace(/[\r\n\t]/g, ' ').slice(0, 100);
    const safeGroupName = groupInfo.name.replace(/[\r\n\t]/g, ' ').slice(0, 100);
    await supabase.functions.invoke('send-notification', {
      body: {
        target_user_id: memberId,
        title: 'Novo grupo',
        message: `${safeName} colocou vc no grupo ${safeGroupName}`,
        type: 'chat',
        reference_id: groupId,
        reference_route: '/chat',
      },
    });

    setGroupInfo(prev => prev
      ? { ...prev, members: [...prev.members, member].sort((a, b) => (a.chat_display_name || a.name || '').localeCompare(b.chat_display_name || b.name || '')) }
      : prev
    );
    setAddingMemberId(null);
  }, [availableGroupMembers, groupId, groupInfo, myId, myName]);

  const handleLeaveGroup = useCallback(() => {
    if (!groupId || !myId || groupInfo?.created_by === myId) return;

    requestConfirm({
      title: 'Sair do grupo',
      message: 'Tem certeza que deseja sair deste grupo?',
      confirmLabel: 'Sair',
      onConfirm: async () => {
        setLeavingGroup(true);
        const { error } = await supabase
          .from('chat_group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', myId);

        if (error) {
          alert('Erro ao sair do grupo.');
          setLeavingGroup(false);
          return;
        }

        setLeavingGroup(false);
        setShowInfo(false);
        setGroupInfo(null);
        setMessages([]);
        onLeftGroup?.(groupId);
        onClose?.();
      },
    });
  }, [groupId, groupInfo?.created_by, myId, onClose, onLeftGroup, requestConfirm]);

  const handleDeleteGroup = useCallback(() => {
    if (!groupId || !myId || groupInfo?.created_by !== myId) return;
    const safeGroupName = groupInfo.name.replace(/[\r\n\t]/g, ' ').slice(0, 100);

    requestConfirm({
      title: 'Excluir grupo',
      message: `Tem certeza que deseja excluir o grupo "${safeGroupName}"? Esta ação removerá o grupo para todos e não poderá ser desfeita.`,
      confirmLabel: 'Excluir',
      onConfirm: async () => {
        setDeletingGroup(true);
        const { error } = await supabase
          .from('chat_groups')
          .delete()
          .eq('id', groupId);

        if (error) {
          alert('Erro ao excluir grupo.');
          setDeletingGroup(false);
          return;
        }

        setDeletingGroup(false);
        setShowInfo(false);
        setGroupInfo(null);
        setMessages([]);
        onLeftGroup?.(groupId);
        onClose?.();
      },
    });
  }, [groupId, groupInfo, myId, onClose, onLeftGroup, requestConfirm]);

  const handleSendAudio = async (blob: Blob) => {
    if (!myId || !otherId || isKAI) return;
    setSending(true);
    const isViewOnce = viewOnce;
    setViewOnce(false);
    // A-05: UUID path to prevent enumeration
    const ext = getChatAudioExtension(blob.type);
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    // P1-03: view-once media goes to private bucket (no authenticated SELECT policy)
    const bucket = isViewOnce ? 'chat-media-private' : 'chat-media';
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: blob.type });
    if (uploadError) {
      console.error('[chat audio upload]', uploadError.message);
      alert(`Falha ao enviar audio: ${uploadError.message}`);
      setSending(false);
      return;
    }
    // P1-01: use local blob URL for immediate display; resolveMediaUrls fetches signed URL via Edge Function on reload
    let displayUrl = '';
    if (!isViewOnce) {
      displayUrl = URL.createObjectURL(blob);
    }
    const tempId = `temp-${Date.now()}`;
    const optimistic: BubbleMessage = {
      id: tempId, type: 'audio', mediaUrl: displayUrl || undefined, mediaPath: path,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString(),
      isMe: true, deliveryStatus: 'sending',
      viewOnce: isViewOnce, viewOnceOpened: false,
    };
    setMessages(prev => [...prev, optimistic]);
    const { error } = await supabase.from('chat_messages').insert({
      sender_id: myId,
      ...(isGroup ? { group_id: groupId } : { receiver_id: otherId }),
      conversation_id: conversationId,
      content: null, type: 'audio', media_url: null, media_path: path,
      view_once: isViewOnce,
    });
    if (error) {
      console.error('[chat audio insert]', error.message);
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert(`Falha ao registrar audio: ${error.message}`);
    } else {
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, deliveryStatus: 'sent' as const } : m
      ));
    }
    setSending(false);
  };

  const handleGalleryFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked || !myId || !otherId || isKAI) return;
    const file = withInferredMime(picked);
    const ALLOWED_GALLERY = ['image/jpeg','image/png','image/gif','image/webp','image/heic','video/mp4','video/quicktime','video/webm'];
    if (!ALLOWED_GALLERY.includes(file.type)) {
      e.target.value = '';
      alert('Este tipo de arquivo não é suportado na galeria.');
      return;
    }
    const isVideo = file.type.startsWith('video/');
    const type = isVideo ? 'video' : 'image';
    const isViewOnce = viewOnce;
    setViewOnce(false);
    setSending(true);
    // A-05: use UUID to prevent path enumeration
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    // P1-03: view-once media goes to private bucket
    const bucket = isViewOnce ? 'chat-media-private' : 'chat-media';
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (uploadError) {
      alert(`Falha ao enviar arquivo: ${uploadError.message}`);
    } else {
      // P1-01: use local blob URL for immediate display
      let displayUrl = '';
      if (!isViewOnce) {
        displayUrl = URL.createObjectURL(file);
      }
      const tempId = `temp-${Date.now()}`;
      const optimistic: BubbleMessage = {
        id: tempId, type, mediaUrl: displayUrl || undefined, mediaPath: path, fileName: file.name,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString(),
        isMe: true, deliveryStatus: 'sending',
        viewOnce: isViewOnce, viewOnceOpened: false,
      };
      setMessages(prev => [...prev, optimistic]);
      const { error } = await supabase.from('chat_messages').insert({
        sender_id: myId,
        ...(isGroup ? { group_id: groupId } : { receiver_id: otherId }),
        conversation_id: conversationId,
        content: null, type, media_url: null, media_path: path, file_name: file.name,
        view_once: isViewOnce,
      });
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, deliveryStatus: error ? 'sending' : 'sent' as const } : m
      ));
    }
    setSending(false);
    e.target.value = '';
  };

  const handleDocumentFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked || !myId || !otherId || isKAI) return;
    const file = withInferredMime(picked);
    const ALLOWED_DOCS = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv'];
    if (!ALLOWED_DOCS.includes(file.type)) {
      e.target.value = '';
      alert('Este tipo de documento não é suportado.');
      return;
    }
    const isViewOnce = viewOnce;
    setViewOnce(false);
    setSending(true);
    // A-05: use UUID to prevent path enumeration
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf';
    const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;
    // P1-03: view-once media goes to private bucket
    const bucket = isViewOnce ? 'chat-media-private' : 'chat-media';
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (uploadError) {
      alert(`Falha ao enviar documento: ${uploadError.message}`);
    } else {
      // P1-01: use local blob URL for immediate display
      let displayUrl = '';
      if (!isViewOnce) {
        displayUrl = URL.createObjectURL(file);
      }
      const tempId = `temp-${Date.now()}`;
      const optimistic: BubbleMessage = {
        id: tempId, text: file.name, type: 'document', mediaUrl: displayUrl || undefined, mediaPath: path, fileName: file.name,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString(),
        isMe: true, deliveryStatus: 'sending',
        viewOnce: isViewOnce, viewOnceOpened: false,
      };
      setMessages(prev => [...prev, optimistic]);
      const { error } = await supabase.from('chat_messages').insert({
        sender_id: myId,
        ...(isGroup ? { group_id: groupId } : { receiver_id: otherId }),
        conversation_id: conversationId,
        content: file.name, type: 'document', media_url: null, media_path: path, file_name: file.name,
        view_once: isViewOnce,
      });
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, deliveryStatus: error ? 'sending' : 'sent' as const } : m
      ));
    }
    setSending(false);
    e.target.value = '';
  };

  const openCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      alert('Não foi possível acessar a câmera.');
      setShowCamera(false);
    }
  };

  const closeCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !myId || !otherId || isKAI) return;
    const isViewOnce = viewOnce;
    setViewOnce(false);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      closeCamera();
      setSending(true);
      // A-05: UUID path to prevent enumeration
      const path = `${conversationId}/${crypto.randomUUID()}.jpg`;
      // P1-03: view-once media goes to private bucket
      const bucket = isViewOnce ? 'chat-media-private' : 'chat-media';
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' });
      if (!uploadError) {
        // P1-01: use local blob URL for immediate display
        let displayUrl = '';
        if (!isViewOnce) {
          displayUrl = URL.createObjectURL(blob);
        }
        const tempId = `temp-${Date.now()}`;
        const optimistic: BubbleMessage = {
          id: tempId, type: 'image', mediaUrl: displayUrl || undefined, mediaPath: path,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toLocaleDateString(),
          isMe: true, deliveryStatus: 'sending',
          viewOnce: isViewOnce, viewOnceOpened: false,
        };
        setMessages(prev => [...prev, optimistic]);
        const { error } = await supabase.from('chat_messages').insert({
          sender_id: myId,
          ...(isGroup ? { group_id: groupId } : { receiver_id: otherId }),
          conversation_id: conversationId,
          content: null, type: 'image', media_url: null, media_path: path,
          view_once: isViewOnce,
        });
        setMessages(prev => prev.map(m =>
          m.id === tempId ? { ...m, deliveryStatus: error ? 'sending' : 'sent' as const } : m
        ));
      }
      setSending(false);
    }, 'image/jpeg', 0.92);
  };

  const handleDeleteForMe = useCallback((msgId: string) => {
    if (!myId) return;

    requestConfirm({
      title: 'Apagar mensagem',
      message: 'Tem certeza que deseja apagar esta mensagem? Ela será removida apenas para você.',
      confirmLabel: 'Apagar',
      onConfirm: async () => {
        const { error } = await supabase.rpc('chat_delete_for_me', { p_message_id: msgId });
        if (!error) {
          setMessages(prev => prev.filter(m => m.id !== msgId));
        }
      },
    });
  }, [myId, requestConfirm]);

  const handleDeleteForAll = useCallback((msgId: string) => {
    if (!myId) return;

    requestConfirm({
      title: 'Apagar para todos',
      message: 'Tem certeza? A mensagem será removida para todos os participantes. Esta ação não poderá ser desfeita.',
      confirmLabel: 'Apagar para todos',
      onConfirm: async () => {
        const previous = messages.find(m => m.id === msgId);
        setMessages(prev => prev.map(m =>
          m.id === msgId && m.isMe
            ? { ...m, is_deleted: true, text: undefined, mediaUrl: undefined }
            : m
        ));
        const { error } = await supabase
          .from('chat_messages')
          .update({ is_deleted: true, content: null, media_url: null })
          .eq('id', msgId)
          .eq('sender_id', myId);
        if (error && previous) {
          setMessages(prev => prev.map(m => m.id === msgId ? previous : m));
        }
      },
    });
  }, [myId, messages, requestConfirm]);

  const handleReact = useCallback(async (msgId: string, emoji: string) => {
    if (!myId) return;

    // Capture state before optimistic update for potential rollback
    let isTogglingOff = false;

    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const reactions = [...(m.reactions ?? [])];
      const existing = reactions.find(r => r.emoji === emoji);
      if (existing && existing.reacted) {
        isTogglingOff = true;
        const updated = reactions
          .map(r => r.emoji === emoji ? { ...r, count: r.count - 1, reacted: false } : r)
          .filter(r => r.count > 0);
        return { ...m, reactions: updated };
      }
      if (existing) {
        return { ...m, reactions: reactions.map(r => r.emoji === emoji ? { ...r, count: r.count + 1, reacted: true } : r) };
      }
      return { ...m, reactions: [...reactions, { emoji, count: 1, reacted: true }] };
    }));

    if (isTogglingOff) {
      await supabase
        .from('chat_message_reactions')
        .delete()
        .eq('message_id', msgId)
        .eq('user_id', myId)
        .eq('emoji', emoji);
    } else {
      await supabase
        .from('chat_message_reactions')
        .upsert({ message_id: msgId, user_id: myId, emoji }, { onConflict: 'message_id,user_id' });
    }
  }, [myId]);

  const handleMarkViewOnceOpened = useCallback(async (msgId: string) => {
    // C-02: use RPC instead of direct UPDATE (receiver can't UPDATE directly)
    // A-02: RPC verifies receiver_id = auth.uid() server-side
    const { error } = await supabase.rpc('chat_open_view_once', { p_message_id: msgId });
    if (!error) {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, viewOnceOpened: true, mediaUrl: undefined } : m
      ));
    }
  }, []);

  const handleOpenViewOnceMedia = useCallback(async (msgId: string): Promise<string | null> => {
    const { data, error } = await supabase.functions.invoke('generate-view-once-url', {
      body: { message_id: msgId },
    });
    if (error || !data?.signedUrl) {
      alert(data?.error || error?.message || 'Nao foi possivel abrir esta midia.');
      return null;
    }
    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, viewOnceOpened: true, mediaUrl: undefined } : m
    ));
    return data.signedUrl;
  }, []);

  const handleSend = async (text: string) => {
    if (!myId || !otherId) return;
    setSending(true);

    if (isKAI) {
      const tempId = `temp-${Date.now()}`;
      const userMsg: BubbleMessage = {
        id: tempId, text, type: 'text',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString(),
        isMe: true, deliveryStatus: 'sending',
      };
      setMessages(prev => [...prev, userMsg]);

      // Persist user message to DB
      const { data: savedUserMsg } = await supabase.from('chat_messages').insert({
        sender_id: myId,
        receiver_id: myId,
        conversation_id: conversationId,
        content: text,
        type: 'text',
      }).select('id').single();
      const realUserMsgId = savedUserMsg?.id ?? tempId;
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, id: realUserMsgId, deliveryStatus: 'sent' as const } : m
      ));

      // Get KAI reply
      const reply = await sendMessageToKai(text, []);
      const tempKaiId = `kai-temp-${Date.now()}`;
      const kaiMsg: BubbleMessage = {
        id: tempKaiId, text: reply, type: 'text',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString(),
        isMe: false, isKAI: true, deliveryStatus: 'sending',
      };
      setMessages(prev => [...prev, kaiMsg]);

      // Persist KAI reply to DB
      const { data: savedKaiMsg } = await supabase.from('chat_messages').insert({
        sender_id: myId,
        receiver_id: myId,
        conversation_id: conversationId,
        content: reply,
        type: 'kai_reply',
      }).select('id').single();
      const realKaiMsgId = savedKaiMsg?.id ?? tempKaiId;
      setMessages(prev => prev.map(m =>
        m.id === tempKaiId ? { ...m, id: realKaiMsgId, deliveryStatus: 'sent' as const } : m
      ));
    } else {
      const tempId = `temp-${Date.now()}`;
      const optimistic: BubbleMessage = {
        id: tempId, text, type: 'text',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toLocaleDateString(),
        isMe: true, deliveryStatus: 'sending',
        viewOnce, viewOnceOpened: false,
      };
      setMessages(prev => [...prev, optimistic]);
      setViewOnce(false);
      const { error } = await supabase.from('chat_messages').insert({
        sender_id: myId,
        ...(isGroup ? { group_id: groupId } : { receiver_id: otherId }),
        conversation_id: conversationId,
        content: text,
        type: 'text',
        view_once: viewOnce,
      });
      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === tempId ? { ...m, deliveryStatus: 'sent' as const } : m
        ));
      }
    }
    setSending(false);
  };

  if (!otherId) return <ChatWelcome />;

  return (
    <>
      <input
        ref={galleryInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
        onChange={handleGalleryFile}
      />
      <input
        ref={documentInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        onChange={handleDocumentFile}
      />

      {/* Camera modal */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-4">
            <button onClick={closeCamera} className="text-white p-2 hover:opacity-70 transition-opacity">
              <X size={24} />
            </button>
            <span className="text-white font-medium">Câmera</span>
            <div className="w-10" />
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex justify-center p-8">
            <button
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full bg-card-bg border-4 border-white/40 hover:scale-95 active:scale-90 transition-transform"
            />
          </div>
        </div>
      )}

      <motion.div
        key={otherId}
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex flex-col h-full bg-surface-50 dark:bg-surface-900/20"
      >
      <ChatDetailHeader
        name={otherName}
        role={otherRole}
        avatarUrl={otherAvatar}
        otherId={otherId}
        isKAI={isKAI}
        isOnline={isOnline}
        onBack={onClose}
        onMore={undefined}
        onProfileClick={openInfo}
      />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-text-secondary" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-secondary">Nenhuma mensagem ainda. Diga olá!</p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => {
              const showDateSep = i === 0 || (msg.date && messages[i - 1]?.date !== msg.date);
              const today = new Date().toLocaleDateString();
              const isToday = msg.date === today;
              const dateLabel = isToday ? 'Hoje' : (msg.date ?? 'Hoje');
              return (
                <div key={msg.id}>
                  {showDateSep && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 h-px bg-surface-200" />
                      <span className="text-xs text-text-secondary">— {dateLabel} —</span>
                      <div className="flex-1 h-px bg-surface-200" />
                    </div>
                  )}
                  <ChatMessageBubble
                    message={msg}
                    index={i}
                    onDeleteForMe={handleDeleteForMe}
                    onDeleteForAll={handleDeleteForAll}
                    onReact={handleReact}
                    onMarkViewOnceOpened={handleMarkViewOnceOpened}
                    onOpenViewOnceMedia={handleOpenViewOnceMedia}
                  />
                </div>
              );
            })}
          </AnimatePresence>
        )}
        <div ref={bottomRef} />
      </div>

      {remoteActivity && (
        <div className="px-4 pb-2 text-xs font-medium text-emerald-600 animate-pulse">
          {remoteActivity.name} {remoteActivity.type === 'recording' ? 'está gravando áudio...' : 'está digitando...'}
        </div>
      )}

      <ChatInputBar
        onSend={handleSend}
        onSendAudio={handleSendAudio}
        onTypingChange={handleTypingChange}
        onRecordingChange={handleRecordingChange}
        onGallery={() => galleryInputRef.current?.click()}
        onAttach={() => documentInputRef.current?.click()}
        onCamera={openCamera}
        sending={sending}
        disabled={!myId}
        viewOnceActive={viewOnce}
        onViewOnceToggle={isKAI ? undefined : () => setViewOnce(v => !v)}
      />
    </motion.div>
    <ChatInfoModal
      open={showInfo}
      onClose={() => setShowInfo(false)}
      loading={infoLoading}
      userInfo={userInfo}
      groupInfo={groupInfo}
      currentUserId={myId}
      removingMemberId={removingMemberId}
      addingMemberId={addingMemberId}
      leavingGroup={leavingGroup}
      deletingGroup={deletingGroup}
      availableMembers={availableGroupMembers}
      onRemoveGroupMember={handleRemoveGroupMember}
      onAddGroupMember={handleAddGroupMember}
      onLeaveGroup={handleLeaveGroup}
      onDeleteGroup={handleDeleteGroup}
    />

    <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
