import { useApp } from '@/context/AppContext';

export type UserRole = 'ADMIN' | 'DIRETOR' | 'GERENTE' | 'COORDENADOR' | 'CORRETOR' | 'RECEPCAO' | 'ANALISTA' | 'EXPORTADOR';

export function useAuthorization() {
    const { profile } = useApp();

    // Normalize role casing to avoid mismatches like 'Corretor' !== 'CORRETOR'
    const rawRole = profile?.role ?? 'CORRETOR';
    const role = String(rawRole).toUpperCase() as UserRole;

    const isAdmin = role === 'ADMIN';
    const isDirector = role === 'DIRETOR';
    const isManager = role === 'GERENTE';
    const isCoordinator = role === 'COORDENADOR';
    const isBroker = role === 'CORRETOR';
    const isReception = role === 'RECEPCAO';
    const isAnalyst = role === 'ANALISTA';
    const isExportador = role === 'EXPORTADOR';
    const canAccessIncomeAnalysis = isAdmin || isDirector || isManager || isCoordinator || isAnalyst;

    // Strategic roles that can see org-wide data in their scope
    const isLeadership = isAdmin || isDirector;
    const isTeamLead = isManager || isCoordinator;

    // Permission helpers
    const canCreateStrategicResources = isAdmin || isDirector;
    const canViewGlobalReports = isAdmin;
    const canViewDirectorateReports = isAdmin || isDirector;
    const canManageTeam = isAdmin || isDirector || isManager || isCoordinator;
    const canAccessAdmin = isAdmin;
    const canViewAllClients = isAdmin || isDirector || isManager || isCoordinator;

    /**
     * Returns true if the user is allowed to navigate to the given route path.
     * Used by ProtectedRoute and nav rendering.
     */
    const canAccess = (path: string): boolean => {
        // Analyst has access only to income analysis and settings
        if (isAnalyst) {
            return path === '/income' || path === '/settings';
        }

        if (path === '/income') {
            return canAccessIncomeAnalysis;
        }

        // Admin-only routes
        if (path === '/admin') return isAdmin;

        // Strategic creation routes — Admin + Director
        if (['/developments', '/portals', '/training', '/reports'].includes(path)) {
            return isAdmin || isDirector || isManager || isCoordinator;
        }

        // All authenticated users can access these
        return true;
    };

    return {
        role,
        isAdmin,
        isDirector,
        isManager,
        isCoordinator,
        isBroker,
        isReception,
        isAnalyst,
        isExportador,
        isLeadership,
        isTeamLead,
        canCreateStrategicResources,
        canViewGlobalReports,
        canViewDirectorateReports,
        canManageTeam,
        canAccessAdmin,
        canViewAllClients,
        canAccessIncomeAnalysis,
        canAccess,
        directorateId: profile?.directorate_id ?? null,
        coordinatorId: (profile as any)?.coordinator_id ?? null,
        managerId: profile?.manager_id ?? null,
    };
}
