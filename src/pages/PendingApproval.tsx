import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundedButton } from '@/components/ui/PremiumComponents';
import { ShieldCheck, LogOut, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function PendingApproval() {
    const navigate = useNavigate();
    const { signOut, profile } = useApp();
    const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);

    // If the profile becomes active while they are on this screen, they can enter
    useEffect(() => {
        if (profile?.status === 'Ativo' || profile?.status === 'active') {
            navigate('/');
        }
    }, [profile?.status, navigate]);

    const handleSignOut = async () => {
        setIsSigningOut(true);
        try {
            await signOut();
            navigate('/login');
        } finally {
            setIsSigningOut(false);
            setIsLogoutConfirmOpen(false);
        }
    };

    return (
        <div className="min-h-screen bg-surface-50 flex flex-col justify-center items-center p-6 text-center">
            <div className="w-full max-w-md bg-card-bg dark:bg-surface-100 rounded-3xl shadow-xl p-10 animate-in fade-in zoom-in-95 duration-700">

                <div className="flex justify-center mb-8 relative">
                    <div className="absolute inset-0 bg-amber-200/50 dark:bg-amber-900/40 rounded-full blur-xl animate-pulse" />
                    <div className="relative w-24 h-24 bg-amber-100 dark:bg-amber-900/50 rounded-full flex items-center justify-center border-4 border-amber-200 dark:border-amber-700/50 shadow-inner">
                        <ShieldCheck size={48} className="text-amber-600 dark:text-amber-500" />
                    </div>
                </div>

                <h1 className="text-2xl font-bold text-text-primary mb-3">
                    Cadastro em Análise
                </h1>

                <p className="text-text-secondary leading-relaxed mb-8">
                    Seu cadastro foi realizado com sucesso! Nossa diretoria está analisando a sua solicitação. Assim que aprovado, você receberá acesso a todas as funcionalidades do aplicativo Kaizen.
                </p>

                <div className="flex items-center justify-center gap-2 text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/20 py-3 px-4 rounded-xl mb-8">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Aguardando liberação de acesso...</span>
                </div>

                <RoundedButton
                    variant="outline"
                    fullWidth
                    onClick={() => setIsLogoutConfirmOpen(true)}
                    className="text-text-secondary hover:text-text-primary border-surface-200"
                >
                    <LogOut size={18} className="mr-2" />
                    Sair e voltar ao Login
                </RoundedButton>

                <ConfirmDialog
                    isOpen={isLogoutConfirmOpen}
                    onClose={() => !isSigningOut && setIsLogoutConfirmOpen(false)}
                    onConfirm={handleSignOut}
                    title="Confirmar saída"
                    message="Tem certeza que deseja sair? Você precisará fazer login novamente para acessar o sistema."
                    confirmLabel="Sair agora"
                    loading={isSigningOut}
                />

            </div>
        </div>
    );
}
