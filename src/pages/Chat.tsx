import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/lib/supabase';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { formatTime, formatPreview } from '@/lib/chat-utils';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatDetailPanel } from '@/components/chat/ChatDetailPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import type { ConversationItemData } from '@/components/chat/ChatConversationItem';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationPreview {
  conversationId: string;
  otherId: string;
  isKAI: boolean;
  isGroup?: boolean;
  groupName?: string;
  lastContent: string;
  lastType: string;
  viewOnce?: boolean;
  lastAt: string;
  senderIsMe: boolean;
}

type ChatProfile = {
  id: string;
  name?: string | null;
  role?: string | null;
  avatar_url?: string | null;
  chat_display_name?: string | null;
  chat_avatar_url?: string | null;
};

type EnrichedConvo = ConversationPreview & {
  name: string;
  role: string;
  avatarUrl: string | null | undefined;
  isUnread: boolean;
  unreadCount: number;
};

// ─── Chat ─────────────────────────────────────────────────────────────────────

export default function Chat() {
  const navigate = useNavigate();
  const { allProfiles, user } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [chatProfiles, setChatProfiles] = useState<Record<string, ChatProfile>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ctxConvo, setCtxConvo] = useState<{ convo: ConversationItemData; x: number; y: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myId = user?.id;
  const { unreadByConversation, totalUnread, markConversationRead } = useChatUnread();

  // ── Desktop detection ─────────────────────────────────────────────────────
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ── Fetch existing conversations ──────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    if (!myId) return;
    const { data: groupMemberships } = await supabase
      .from('chat_group_members')
      .select('group_id, chat_groups!inner(id, name, created_at)')
      .eq('user_id', myId);

    const groups = (groupMemberships ?? [])
      .map((m: any) => m.chat_groups)
      .filter(Boolean) as { id: string; name: string; created_at: string }[];
    const groupIds = groups.map(group => group.id);
    const groupById = new Map(groups.map(group => [group.id, group]));

    const [{ data }, { data: groupMessages }] = await Promise.all([
      supabase
        .from('chat_messages')
        .select('conversation_id, content, type, view_once, created_at, sender_id, receiver_id, group_id')
        .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
        .order('created_at', { ascending: false }),
      groupIds.length > 0
        ? supabase
          .from('chat_messages')
          .select('conversation_id, content, type, view_once, created_at, sender_id, group_id')
          .in('group_id', groupIds)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const seen = new Set<string>();
    const convos: ConversationPreview[] = [];

    for (const msg of (data ?? [])) {
      if (msg.group_id || msg.conversation_id?.startsWith('group-')) continue;
      if (seen.has(msg.conversation_id)) continue;
      seen.add(msg.conversation_id);
      try {
        if (localStorage.getItem(`hidden-conv-${myId}-${msg.conversation_id}`)) continue;
      } catch {}
      const isKAI = msg.conversation_id.startsWith('kai-');
      const otherId = isKAI ? 'kai-agent'
        : (msg.sender_id === myId ? msg.receiver_id : msg.sender_id);

      convos.push({
        conversationId: msg.conversation_id,
        otherId,
        isKAI,
        lastContent: msg.content || '',
        lastType: msg.type || 'text',
        viewOnce: msg.view_once ?? false,
        lastAt: msg.created_at,
        senderIsMe: msg.sender_id === myId,
      });
    }

    const latestGroupMessageByGroupId = new Map<string, any>();
    for (const msg of (groupMessages ?? [])) {
      if (!msg.group_id || latestGroupMessageByGroupId.has(msg.group_id)) continue;
      latestGroupMessageByGroupId.set(msg.group_id, msg);
    }

    for (const group of groupById.values()) {
      const convId = `group-${group.id}`;
      const latestMessage = latestGroupMessageByGroupId.get(group.id);
      convos.push({
        conversationId: convId,
        otherId: convId,
        isKAI: false,
        isGroup: true,
        groupName: group.name,
        lastContent: latestMessage?.content || 'Grupo criado',
        lastType: latestMessage?.type || 'text',
        viewOnce: latestMessage?.view_once ?? false,
        lastAt: latestMessage?.created_at || group.created_at,
        senderIsMe: latestMessage?.sender_id === myId,
      });
    }

    setConversations(convos.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()));
    setLoading(false);
  }, [myId]);

  useEffect(() => {
    fetchConversations();
    if (!myId) return;
    const ch = supabase
      .channel('chat-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (p) => {
          const m = p.new as any;
          if (m.group_id || m.conversation_id?.startsWith('group-') || m.sender_id === myId || m.receiver_id === myId) {
            try { localStorage.removeItem(`hidden-conv-${myId}-${m.conversation_id}`); } catch {}
            fetchConversations();
          }
        })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_group_members',
        filter: `user_id=eq.${myId}`,
      }, () => {
        fetchConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myId, fetchConversations]);

  useEffect(() => {
    const ids = Array.from(new Set(
      conversations
        .filter(c => !c.isKAI && !c.isGroup && c.otherId)
        .map(c => c.otherId)
    ));
    const missingIds = ids.filter(id => !chatProfiles[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    supabase
      .from('profiles')
      .select('id, name, role, avatar_url, chat_display_name, chat_avatar_url')
      .in('id', missingIds)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('[chat profiles] failed to resolve conversation profiles:', error.message);
          return;
        }
        if (!data?.length) return;
        setChatProfiles(prev => ({
          ...prev,
          ...Object.fromEntries((data as ChatProfile[]).map(p => [p.id, p])),
        }));
      });

    return () => { cancelled = true; };
  }, [allProfiles, chatProfiles, conversations]);

  // ── Delete conversation (apenas para mim — oculta via localStorage) ───────
  const handleDeleteConversation = (conversationId: string) => {
    if (!myId) return;
    requestConfirm({
      title: 'Apagar conversa',
      message: 'Tem certeza que deseja apagar esta conversa? As mensagens serão removidas somente para você.',
      confirmLabel: 'Apagar',
      onConfirm: () => {
        try { localStorage.setItem(`hidden-conv-${myId}-${conversationId}`, '1'); } catch {}
        setConversations(prev => prev.filter(c => c.conversationId !== conversationId));
        if (selectedId && ctxConvo?.convo.conversationId === conversationId) {
          setSelectedId(null);
        }
        setCtxConvo(null);
      },
    });
  };

  const handleConvoTouchStart = (e: React.TouchEvent, convo: ConversationItemData) => {
    const touch = e.touches[0];
    pressTimer.current = setTimeout(() => {
      setCtxConvo({ convo, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  const handleConvoTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  const handleConvoRightClick = (e: React.MouseEvent, convo: ConversationItemData) => {
    e.preventDefault();
    setCtxConvo({ convo, x: e.clientX, y: e.clientY });
  };

  // ── Enriched conversations ────────────────────────────────────────────────
  const enrichedConvos = useMemo<EnrichedConvo[]>(() =>
    conversations.map(c => {
      const unreadCount = unreadByConversation[c.conversationId] ?? 0;
      const isUnread = unreadCount > 0;
      if (c.isKAI) {
        return {
          ...c,
          name: 'KAI',
          role: 'Assistente IA',
          avatarUrl: null as string | null | undefined,
          isUnread,
          unreadCount,
        };
      }
      if (c.isGroup) {
        return {
          ...c,
          name: c.groupName || 'Grupo',
          role: 'Grupo',
          avatarUrl: null as string | null | undefined,
          isUnread,
          unreadCount,
        };
      }
      const p = allProfiles?.find(pr => pr.id === c.otherId) ?? chatProfiles[c.otherId];
      return {
        ...c,
        name: p?.chat_display_name || p?.name || 'Usuário',
        role: p?.role || '',
        avatarUrl: p?.chat_avatar_url || p?.avatar_url,
        isUnread,
        unreadCount,
      };
    }),
  [conversations, allProfiles, chatProfiles, unreadByConversation]);

  // ── Map to ConversationItemData for sidebar ───────────────────────────────
  const sidebarConvos = useMemo<ConversationItemData[]>(() => {
    const mapped = enrichedConvos.map(c => ({
      conversationId: c.conversationId,
      otherId: c.otherId,
      isKAI: c.isKAI,
      isGroup: c.isGroup,
      name: c.name,
      role: c.role,
      avatarUrl: c.avatarUrl,
      preview: formatPreview(c.lastType, c.lastContent, c.senderIsMe, c.viewOnce),
      timestamp: formatTime(c.lastAt),
      unreadCount: c.unreadCount,
      isOnline: c.isKAI ? true : undefined,
    }));
    // grupos primeiro, depois KAI, depois conversas individuais — cada grupo mantém ordem original
    return [
      ...mapped.filter(c => c.isGroup),
      ...mapped.filter(c => !c.isGroup),
    ];
  }, [enrichedConvos]);

  // ── Selected convo info ───────────────────────────────────────────────────
  const selectedConvo = useMemo(() =>
    sidebarConvos.find(c => c.otherId === selectedId) ?? null,
  [sidebarConvos, selectedId]);

  // ── Unified select handlers ───────────────────────────────────────────────
  const handleSelect = (otherId: string) => {
    if (isDesktop) {
      setSelectedId(otherId);
      const conv = sidebarConvos.find(c => c.otherId === otherId);
      if (conv) markConversationRead(conv.conversationId);
    } else {
      navigate(otherId === 'kai-agent' ? '/chat/kai-agent' : `/chat/${otherId}`);
    }
  };

  const handleKaiClick = () => {
    if (isDesktop) {
      setSelectedId('kai-agent');
      const kaiConv = sidebarConvos.find(c => c.isKAI);
      if (kaiConv) markConversationRead(kaiConv.conversationId);
    } else {
      navigate('/chat/kai-agent');
    }
  };

  const handleLeftGroup = (groupId: string) => {
    const conversationId = `group-${groupId}`;
    setConversations(prev => prev.filter(c => c.conversationId !== conversationId));
    setSelectedId(prev => prev === conversationId ? null : prev);
  };

  return (
    <>
      {/* Desktop split-view */}
      <div className="hidden lg:flex h-[calc(100vh-3.5rem)] -mx-2 sm:-mx-4 lg:-mx-6 overflow-hidden">
        {/* Left panel */}
        <div className="w-80 flex-shrink-0 flex flex-col">
          <ChatSidebar
            conversations={sidebarConvos}
            selectedId={selectedId}
            totalUnread={totalUnread}
            onSelect={handleSelect}
            onKaiClick={handleKaiClick}
            onContextMenu={handleConvoRightClick}
            onTouchStart={handleConvoTouchStart}
            onTouchEnd={handleConvoTouchEnd}
            loading={loading}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          <ChatDetailPanel
            otherId={selectedId}
            otherName={selectedId === 'kai-agent' ? 'KAI' : (selectedConvo?.name ?? '')}
            otherRole={selectedConvo?.role}
            otherAvatar={selectedConvo?.avatarUrl}
            isKAI={selectedId === 'kai-agent' || selectedConvo?.isKAI}
            isGroup={selectedConvo?.isGroup}
            isOnline={selectedConvo?.isOnline}
            onClose={() => setSelectedId(null)}
            onLeftGroup={handleLeftGroup}
          />
        </div>
      </div>

      {/* Mobile list */}
      <div className="flex flex-col lg:hidden h-screen bg-surface-50 pb-20">
        <ChatSidebar
          conversations={sidebarConvos}
          selectedId={null}
          totalUnread={totalUnread}
          onSelect={handleSelect}
          onKaiClick={handleKaiClick}
          onContextMenu={handleConvoRightClick}
          onTouchStart={handleConvoTouchStart}
          onTouchEnd={handleConvoTouchEnd}
          loading={loading}
        />
      </div>

      {/* Context menu: apagar conversa */}
      {ctxConvo && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxConvo(null)} />
          <div
            className="fixed z-50 bg-card-bg rounded-2xl shadow-2xl border border-surface-100 overflow-hidden min-w-[200px]"
            style={{
              top: Math.min(ctxConvo.y, window.innerHeight - 80),
              left: Math.min(ctxConvo.x, window.innerWidth - 220),
            }}
          >
            <div className="px-4 py-3 border-b border-surface-100">
              <p className="text-sm font-semibold text-text-primary truncate max-w-[160px]">{ctxConvo.convo.name}</p>
              <p className="text-xs text-text-secondary">Conversa</p>
            </div>
            <button
              onClick={() => handleDeleteConversation(ctxConvo.convo.conversationId)}
              className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={16} /> Apagar conversa para mim
            </button>
          </div>
        </>
      )}

      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
