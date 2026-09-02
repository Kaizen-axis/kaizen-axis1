import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useAnimation } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
    Bell, CheckCheck, Trash2,
    UserPlus, MessageCircle, AlertTriangle, Target, Briefcase, Megaphone, Info, ListTodo
} from 'lucide-react';
import { useNotifications, Notification } from '@/context/NotificationContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { CHAT_FEATURE_LOCKED, isChatPath } from '@/lib/chatAccess';

// Helper to calculate relative time
const timeAgo = (dateStr: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(dateStr).toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' });
};

// Map notification type to icon and colors
const getTypeConfig = (type: string) => {
    switch (type) {
        case 'lead':    return { icon: <UserPlus size={16} />,     color: 'text-blue-500',         bg: 'bg-blue-50 dark:bg-blue-900/30' };
        case 'chat':    return { icon: <MessageCircle size={16} />, color: 'text-green-500',        bg: 'bg-green-50 dark:bg-green-900/30' };
        case 'aviso':   return { icon: <AlertTriangle size={16} />, color: 'text-red-500',          bg: 'bg-red-50 dark:bg-red-900/30' };
        case 'meta':    return { icon: <Target size={16} />,        color: 'text-purple-500',       bg: 'bg-purple-50 dark:bg-purple-900/30' };
        case 'tarefa':  return { icon: <ListTodo size={16} />,      color: 'text-amber-500',        bg: 'bg-amber-50 dark:bg-amber-900/30' };
        case 'missao':  return { icon: <Briefcase size={16} />,     color: 'text-indigo-500',       bg: 'bg-indigo-50 dark:bg-indigo-900/30' };
        case 'anuncio': return { icon: <Megaphone size={16} />,     color: 'text-orange-500',       bg: 'bg-orange-50 dark:bg-orange-900/30' };
        default:        return { icon: <Info size={16} />,          color: 'text-text-secondary',   bg: 'bg-subtle-bg' };
    }
};

const NotificationItem = ({
    notification,
    onCloseDropdown
}: {
    notification: Notification;
    onCloseDropdown: () => void;
}) => {
    const { markAsRead, deleteNotification } = useNotifications();
    const navigate = useNavigate();
    const controls = useAnimation();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleClick = () => {
        if (!notification.is_read) {
            markAsRead(notification.id);
        }
        if (notification.reference_route) {
            if (!(CHAT_FEATURE_LOCKED && isChatPath(notification.reference_route))) {
                navigate(notification.reference_route);
            }
        }
        onCloseDropdown();
    };

    const handleDragEnd = async (event: any, info: any) => {
        // If dragged enough to the left (e.g. -80px), trigger delete
        if (info.offset.x < -60) {
            setIsDeleting(true);
            await controls.start({ x: -500, opacity: 0, transition: { duration: 0.2 } });
            deleteNotification(notification.id);
        } else {
            // Snap back to original position
            controls.start({ x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } });
        }
    };

    const config = getTypeConfig(notification.type);

    // We wrap the list item in a relative container to allow the red delete background to show below it
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className="relative border-b border-surface-100 last:border-b-0 group overflow-hidden"
        >
            {/* Background reveal for Swipe to Delete */}
            <div className="absolute inset-0 bg-red-500 flex items-center justify-end px-6 text-white z-0">
                <Trash2 size={20} />
            </div>

            <motion.div
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 0.5, right: 0 }} // Elastic pulling to the left
                onDragEnd={handleDragEnd}
                animate={controls}
                whileDrag={{ cursor: 'grabbing' }}
                onClick={handleClick}
                className={`relative z-10 w-full flex items-start gap-3 p-4 cursor-pointer transition-colors ${notification.is_read ? 'bg-card-bg' : 'bg-surface-50'
                    } ${isDeleting ? 'pointer-events-none' : ''}`}
            >
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${config.bg} ${config.color}`}>
                    {config.icon}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                        <h4 className={`text-sm truncate pr-2 ${notification.is_read ? 'font-semibold text-text-primary' : 'font-bold text-text-primary'}`}>
                            {notification.title}
                        </h4>
                        <span className="text-[10px] text-text-secondary whitespace-nowrap mt-0.5">
                            {timeAgo(notification.created_at)}
                        </span>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-2 leading-tight">
                        {notification.message}
                    </p>
                </div>

                {!notification.is_read && (
                    <div className="flex-shrink-0 self-center">
                        <div className="w-2 h-2 rounded-full bg-gold-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]"></div>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
};

export const NotificationBell = () => {
    const { notifications, unreadCount, markAllAsRead, deleteAllNotifications, loading } = useNotifications();
    const { requestConfirm, confirmDialogProps } = useConfirmDialog();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown if clicked outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-10 min-h-11 min-w-11 rounded-full flex items-center justify-center bg-card-bg border border-surface-200 text-text-secondary hover:text-gold-500 hover:border-gold-300 transition-all relative"
            >
                <Bell size={20} />
                <AnimatePresence>
                    {unreadCount > 0 && (
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow-sm ring-2 ring-card-bg"
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </motion.div>
                    )}
                </AnimatePresence>
            </button>

            {/* Dropdown Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-1.5rem))] sm:w-96 bg-card-bg border border-surface-200 shadow-2xl rounded-2xl overflow-hidden z-50 flex flex-col"
                    >
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-surface-100 flex items-center justify-between bg-surface-50/50">
                            <h3 className="text-sm font-bold text-text-primary">Notificações</h3>
                            {notifications.length > 0 && (
                                <button
                                    onClick={() => {
                                        requestConfirm({
                                            title: 'Limpar notificações',
                                            message: 'Tem certeza que deseja limpar todas as notificações? Esta ação não poderá ser desfeita.',
                                            confirmLabel: 'Limpar todas',
                                            onConfirm: () => deleteAllNotifications(),
                                        });
                                    }}
                                    className="text-[11px] font-semibold text-gold-600 hover:text-gold-700 flex items-center gap-1 transition-colors"
                                >
                                    <CheckCheck size={14} /> Limpar Todas
                                </button>
                            )}
                        </div>

                        {/* List Body */}
                        <div className="max-h-[60vh] overflow-y-auto no-scrollbar relative bg-surface-50">
                            {loading && notifications.length === 0 ? (
                                <div className="p-8 flex justify-center">
                                    <div className="w-6 h-6 border-2 border-surface-200 border-t-gold-500 rounded-full animate-spin"></div>
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="p-8 text-center flex flex-col items-center">
                                    <div className="w-12 h-12 rounded-full bg-surface-100 flex items-center justify-center text-surface-300 mb-3">
                                        <Bell size={24} />
                                    </div>
                                    <p className="text-sm font-medium text-text-secondary">Nenhuma notificação</p>
                                    <p className="text-xs text-text-secondary/70 mt-1">Você está em dia com tudo!</p>
                                </div>
                            ) : (
                                <AnimatePresence initial={false}>
                                    {notifications.map((notif) => (
                                        <NotificationItem
                                            key={notif.id}
                                            notification={notif}
                                            onCloseDropdown={() => setIsOpen(false)}
                                        />
                                    ))}
                                </AnimatePresence>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <ConfirmDialog {...confirmDialogProps} />
        </div>
    );
};
