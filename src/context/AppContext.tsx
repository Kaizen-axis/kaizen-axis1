import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Client, ClientProponent } from '@/data/clients';
import { AutomationLead } from '@/data/leads';
import { supabase } from '@/lib/supabase';
import { logAuditEvent } from '@/services/auditLogger';
import { rateLimiter } from '@/services/rateLimiter';
import { Session, User } from '@supabase/supabase-js';
import confetti from 'canvas-confetti';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Directorate {
  id: string;
  name: string;
  description?: string;
  manager_id?: string | null;
  created_at?: string;
}

export interface Profile {
  id: string;
  name: string;
  role: string;
  team?: string;
  team_id?: string | null;      // UUID FK to teams (normalized)
  status?: string;
  directorate_id?: string | null;
  manager_id?: string | null;
  coordinator_id?: string | null;
  avatar_url?: string | null;
  chat_display_name?: string | null;
  chat_avatar_url?: string | null;
  chat_status_text?: string | null;
  chat_availability?: string | null;
}

export interface Appointment {
  id: string;
  user_id?: string;
  title: string;
  client_name?: string;
  client_id?: string;
  date: string; // YYYY-MM-DD
  time: string;
  location?: string;
  type: 'Visita' | 'Reunião' | 'Assinatura' | 'Outro';
  completed: boolean;
  created_at?: string;
}

export interface Task {
  id: string;
  user_id?: string;
  owner_id?: string;
  created_by?: string;
  assigned_to?: string;
  assigned_by_role?: string;
  assignment_scope?: 'INDIVIDUAL' | 'TEAM';
  title: string;
  responsible?: string;
  deadline?: string;
  status: 'Pendente' | 'Em Andamento' | 'Concluída';
  description?: string;
  subtasks: { id: string; title: string; completed: boolean }[];
  completed_at?: string | null;
  archived_at?: string | null;
  created_at?: string;
}

export interface Development {
  id: string;
  user_id?: string;
  name: string;
  builder?: string;
  location?: string;
  address?: string;
  price?: string;
  min_income?: string;
  type?: string;
  status?: string;
  description?: string;
  differentials?: string[];
  images?: string[];
  book_pdf_url?: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
    role?: string;
    avatar?: string;
  };
  created_at?: string;
}

export interface Team {
  id: string;
  name: string;
  manager_id?: string | null;
  directorate_id?: string | null;
  total_sales?: string;
  members?: string[];
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  target?: number;
  current_progress?: number;
  start_date?: string;
  deadline?: string;
  type?: string;
  assignee_type?: string;
  assignee_id?: string | null;
  points?: number;
  measure_type?: string;
  status?: 'active' | 'achieved' | 'failed';
  closed_at?: string;
  property_id?: string;
  objective_type?: 'sales' | 'approved_clients';
  directorate_id?: string | null;
}

export interface Portal {
  id: string;
  name: string;
  url: string;
  category: 'Banco' | 'Construtora' | 'Outro';
  description?: string;
  created_by?: string;
  created_at?: string;
}

export interface TrainingItem {
  id: string;
  title: string;
  type: 'Vídeo' | 'PDF' | 'Imagem';
  url: string;
  thumbnail?: string;
  duration?: string;
  description?: string;
  xp_reward?: number;
  progress?: number;
  created_by?: string;
  created_at?: string;
}

export interface Announcement {
  id: string;
  author_id?: string;
  title: string;
  content?: string;
  priority?: 'Normal' | 'Importante' | 'Urgente';
  start_date?: string;
  end_date?: string;
  created_at?: string;
  directorate_id?: string | null;
  assignee_type?: string;
  assignee_id?: string | null;
}

interface AppContextValue {
  // Auth
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  allProfiles: Profile[];
  userName: string;
  userRole: string;
  signOut: () => Promise<void>;
  refreshProfiles: () => Promise<void>;
  updateProfile: (id: string, data: Partial<Profile>) => Promise<void>;

  // Clients
  clients: Client[];
  loading: boolean;
  addClient: (data: Omit<Client, 'id' | 'history' | 'documents' | 'createdAt'>) => Promise<Client | null>;
  updateClient: (id: string, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: string) => Promise<void>;
  getClient: (id: string) => Client | undefined;
  refreshClients: () => Promise<void>;
  addClientProponent: (clientId: string, data: Omit<ClientProponent, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>) => Promise<{ success: boolean; error?: string }>;
  updateClientProponent: (id: string, data: Partial<Omit<ClientProponent, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>) => Promise<{ success: boolean; error?: string }>;
  deleteClientProponent: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Leads
  leads: AutomationLead[];
  refreshLeads: () => Promise<void>;
  updateLead: (id: string, data: Partial<AutomationLead>) => Promise<void>;
  convertLeadToClient: (leadId: string, clientData: any) => Promise<{ success: boolean; clientId?: string }>;

  // Storage
  uploadFile: (file: File, path: string, bucket?: string) => Promise<string | null>;
  addDocumentToClient: (clientId: string, name: string, path: string) => Promise<{ success: boolean; error?: string }>;
  deleteDocumentFromClient: (docId: string, filePath?: string) => Promise<{ success: boolean; error?: string }>;
  renameClientDocument: (docId: string, name: string) => Promise<{ success: boolean; error?: string }>;
  getDownloadUrl: (path: string, bucket?: string) => Promise<string | null>;

  // Appointments
  appointments: Appointment[];
  refreshAppointments: () => Promise<void>;
  addAppointment: (data: Omit<Appointment, 'id' | 'created_at'>) => Promise<void>;
  updateAppointment: (id: string, data: Partial<Appointment>) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;

  // Tasks
  tasks: Task[];
  refreshTasks: () => Promise<void>;
  addTask: (data: Omit<Task, 'id' | 'created_at'>) => Promise<void>;
  updateTask: (id: string, data: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  // Developments
  developments: Development[];
  refreshDevelopments: () => Promise<void>;
  addDevelopment: (data: Omit<Development, 'id' | 'created_at'>) => Promise<Development | null>;
  updateDevelopment: (id: string, data: Partial<Development>) => Promise<void>;
  deleteDevelopment: (id: string) => Promise<void>;

  // Admin - Teams
  teams: Team[];
  refreshTeams: () => Promise<void>;
  addTeam: (data: Omit<Team, 'id'>) => Promise<void>;
  updateTeam: (id: string, data: Partial<Team>) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;

  // Admin - Goals
  goals: Goal[];
  refreshGoals: () => Promise<void>;
  addGoal: (data: Omit<Goal, 'id'>) => Promise<void>;
  updateGoal: (id: string, data: Partial<Goal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;

  // Admin - Announcements
  announcements: Announcement[];
  refreshAnnouncements: () => Promise<void>;
  addAnnouncement: (data: Omit<Announcement, 'id' | 'created_at'>) => Promise<void>;
  updateAnnouncement: (id: string, data: Partial<Announcement>) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;

  // Admin - Diretorias
  directorates: Directorate[];
  refreshDirectorates: () => Promise<void>;
  addDirectorate: (data: Omit<Directorate, 'id' | 'created_at'>) => Promise<void>;
  updateDirectorate: (id: string, data: Partial<Directorate>) => Promise<void>;
  deleteDirectorate: (id: string) => Promise<void>;

  // Portals
  portals: Portal[];
  refreshPortals: () => Promise<void>;
  addPortal: (data: Omit<Portal, 'id' | 'created_at'>) => Promise<void>;
  updatePortal: (id: string, data: Partial<Portal>) => Promise<void>;
  deletePortal: (id: string) => Promise<void>;

  // Trainings
  trainings: TrainingItem[];
  refreshTrainings: () => Promise<void>;
  addTraining: (data: Omit<TrainingItem, 'id' | 'created_at'>) => Promise<void>;
  updateTraining: (id: string, data: Partial<TrainingItem>) => Promise<void>;
  deleteTraining: (id: string) => Promise<void>;
  completeTraining: (id: string) => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppContext = createContext<AppContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<AutomationLead[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [developments, setDevelopments] = useState<Development[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [directorates, setDirectorates] = useState<Directorate[]>([]);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [trainings, setTrainings] = useState<TrainingItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Refs para evitar loop infinito: refreshLeads/refreshClients lê esses valores sem depender deles
  const profileRef = React.useRef(profile);
  const userRef = React.useRef(user);
  const userRoleRef = React.useRef('Corretor');
  const allProfilesRef = React.useRef<Profile[]>([]);
  React.useEffect(() => { profileRef.current = profile; }, [profile]);
  React.useEffect(() => { userRef.current = user; }, [user]);
  React.useEffect(() => { userRoleRef.current = profile?.role || 'Corretor'; }, [profile]);
  React.useEffect(() => { allProfilesRef.current = allProfiles; }, [allProfiles]);

  const userName = profile?.name || user?.email || 'Usuário';
  const userRole = profile?.role || 'Corretor';

  // ─── Confetti Logic ───────────────────────────────────────────────────────
  const previousGoalsRef = React.useRef<Goal[]>([]);

  React.useEffect(() => {
    if (goals.length > 0 && previousGoalsRef.current.length > 0) {
      // Check if any previously unachieved active goal just became achieved
      const newlyAchievedGoals = goals.filter((currentGoal) => {
        const previousGoal = previousGoalsRef.current.find((g) => g.id === currentGoal.id);
        if (!previousGoal) return false;

        const wasAchieved = (previousGoal.current_progress || 0) >= (previousGoal.target || 1);
        const isNowAchieved = (currentGoal.current_progress || 0) >= (currentGoal.target || 1);

        // Only celebrate active/ongoing goals that crossed the line
        return !wasAchieved && isNowAchieved && currentGoal.status !== 'failed';
      });

      if (newlyAchievedGoals.length > 0) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#D4AF37', '#FFDF00', '#FFFFFF', '#10B981'] // Gold, Silver, Emerald
        });
      }
    }
    // Update ref for next render cycle
    previousGoalsRef.current = goals;
  }, [goals]);

  // ─── System Events (Gamification) ─────────────────────────────────────────
  React.useEffect(() => {
    if (!user) return;

    const channel = supabase.channel('public:system_events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'system_events',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const eventInfo: any = payload.new;
          if (
            eventInfo.type === 'achievement_unlocked' ||
            eventInfo.type === 'goal_achieved' ||
            eventInfo.type === 'mission_completed' ||
            eventInfo.type === 'training_completed'
          ) {
            confetti({
              particleCount: 200,
              spread: 100,
              origin: { y: 0.6 },
              colors: ['#D4AF37', '#FFDF00', '#FFFFFF', '#10B981'] // Gold, Silver, Emerald
            });
            // Optional: Show browser alert if desired.
            if (eventInfo.payload?.title) {
              console.log(`[Gamification Event]: ${eventInfo.payload.title}`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // ─── Auth ─────────────────────────────────────────────────────────────────

  const fetchProfile = async (userId: string) => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (data) {
        setProfile(data);
        return data as Profile;
      }
    } catch (e) {
      console.error('Erro ao buscar perfil:', e);
    }
    return null;
  };

  const refreshProfiles = useCallback(async () => {
    try {
      const { data } = await supabase.from('profiles').select('*').order('name');
      setAllProfiles(data || []);
    } catch (e) {
      console.error('Erro ao buscar profiles:', e);
    }
  }, []);

  const updateProfile = useCallback(async (id: string, data: Partial<Profile>) => {
    try {
      const hasOwnField = (field: keyof Profile) => Object.prototype.hasOwnProperty.call(data, field);
      const touchesTeam = hasOwnField('team') || hasOwnField('team_id');
      const touchesDirectorate = hasOwnField('directorate_id');
      const touchesManager = hasOwnField('manager_id');
      const touchesCoordinator = hasOwnField('coordinator_id');

      let previousScope: {
        team: string | null;
        team_id: string | null;
        directorate_id: string | null;
        manager_id: string | null;
        coordinator_id: string | null;
      } | null = null;

      if (touchesTeam || touchesDirectorate || touchesManager || touchesCoordinator) {
        const { data: previousData, error: previousError } = await supabase
          .from('profiles')
          .select('team, team_id, directorate_id, manager_id, coordinator_id')
          .eq('id', id)
          .single();
        if (previousError) throw previousError;

        previousScope = {
          team: previousData?.team ?? null,
          team_id: previousData?.team_id ?? null,
          directorate_id: previousData?.directorate_id ?? null,
          manager_id: previousData?.manager_id ?? null,
          coordinator_id: previousData?.coordinator_id ?? null,
        };
      }

      const updatePayload: any = { ...data };
      let resolvedTouchesDirectorate = touchesDirectorate;
      let resolvedTouchesManager = touchesManager;
      let resolvedTouchesCoordinator = touchesCoordinator;
      let handledTeamByRpc = false;
      let rpcNextTeamId: string | null = null;

      let nextTeamMeta: { name: string | null; directorate_id: string | null; manager_id: string | null } | null = null;

      if (touchesTeam) {
        const rawTeam = hasOwnField('team_id') ? data.team_id : data.team;

        const currentRole = String(profileRef.current?.role || '').trim().toUpperCase();
        const canUseAdminTeamRpc = currentRole === 'ADMIN' || currentRole === 'DIRETOR';

        if (canUseAdminTeamRpc && rawTeam !== undefined) {
          const requestedTeamId = (typeof rawTeam === 'string' ? rawTeam.trim() : rawTeam) || null;
          const explicitCoordinator = hasOwnField('coordinator_id') ? (data.coordinator_id ?? null) : null;

          const { error: rpcError } = await supabase.rpc('admin_set_profile_team', {
            p_profile_id: id,
            p_team_id: requestedTeamId,
            p_coordinator_id: explicitCoordinator,
          });

          if (rpcError) {
            throw new Error(`RPC admin_set_profile_team falhou: ${rpcError.message}`);
          } else {
            handledTeamByRpc = true;
            rpcNextTeamId = requestedTeamId;
            delete updatePayload.team;
            delete updatePayload.team_id;
          }
        }

        if (!handledTeamByRpc && rawTeam === undefined) {
          delete updatePayload.team;
          delete updatePayload.team_id;
        } else if (!handledTeamByRpc) {
          const normalizedTeamRef = typeof rawTeam === 'string' ? rawTeam.trim() : rawTeam;
          let normalizedTeam = normalizedTeamRef || null;

          // Sempre persiste o vínculo informado; metadados da equipe são best-effort.
          updatePayload.team = normalizedTeam;
          updatePayload.team_id = normalizedTeam;

          if (normalizedTeam) {
            let teamMeta: { id: string; name: string | null; directorate_id: string | null; manager_id: string | null } | null = null;

            const { data: byIdTeam, error: byIdError } = await supabase
              .from('teams')
              .select('id, name, directorate_id, manager_id')
              .eq('id', normalizedTeam)
              .maybeSingle();
            if (byIdError) {
              console.warn('Falha ao resolver equipe por id (seguindo com vínculo informado):', byIdError.message);
            }

            if (byIdTeam) {
              teamMeta = byIdTeam as any;
            } else if (typeof normalizedTeam === 'string') {
              const { data: byNameTeam, error: byNameError } = await supabase
                .from('teams')
                .select('id, name, directorate_id, manager_id')
                .ilike('name', normalizedTeam)
                .limit(1)
                .maybeSingle();
              if (byNameError) {
                console.warn('Falha ao resolver equipe por nome legado (seguindo com vínculo informado):', byNameError.message);
              }
              if (byNameTeam) teamMeta = byNameTeam as any;
            }

            if (!teamMeta?.id) {
              console.warn(`Equipe sem metadados para ${id}. Mantendo team/team_id como informado:`, rawTeam);
              nextTeamMeta = null;
            } else {
              normalizedTeam = teamMeta.id;
              updatePayload.team = normalizedTeam;
              updatePayload.team_id = normalizedTeam;

              nextTeamMeta = {
                name: teamMeta?.name ?? null,
                directorate_id: teamMeta?.directorate_id ?? null,
                manager_id: teamMeta?.manager_id ?? null,
              };

              if (!resolvedTouchesDirectorate) {
                updatePayload.directorate_id = nextTeamMeta.directorate_id;
                resolvedTouchesDirectorate = true;
              }

              if (!resolvedTouchesManager) {
                updatePayload.manager_id = nextTeamMeta.manager_id;
                resolvedTouchesManager = true;
              }

              if (!resolvedTouchesCoordinator) {
                const { data: coordinatorRows, error: coordinatorRowsError } = await supabase
                  .from('profiles')
                  .select('id, status, role')
                  .or(`team.eq.${normalizedTeam},team_id.eq.${normalizedTeam}`);

                if (coordinatorRowsError) {
                  console.warn('Falha ao resolver coordenador automático da equipe:', coordinatorRowsError.message);
                }

                const activeCoordinator = (coordinatorRows || []).find((row: any) => {
                  const role = String(row?.role || '').toUpperCase();
                  if (role !== 'COORDENADOR') return false;
                  const status = String(row?.status || '').toLowerCase();
                  return status === 'ativo' || status === 'active' || status === '';
                });

                updatePayload.coordinator_id = activeCoordinator?.id || null;
                resolvedTouchesCoordinator = true;
              }
            }
          } else {
            updatePayload.team = null;
            updatePayload.team_id = null;
            if (!resolvedTouchesManager) {
              updatePayload.manager_id = null;
              resolvedTouchesManager = true;
            }
            if (!resolvedTouchesCoordinator) {
              updatePayload.coordinator_id = null;
              resolvedTouchesCoordinator = true;
            }
          }
        }
      }

      if (resolvedTouchesDirectorate && updatePayload.directorate_id === undefined) {
        delete updatePayload.directorate_id;
      }
      if (resolvedTouchesManager && updatePayload.manager_id === undefined) {
        delete updatePayload.manager_id;
      }
      if (resolvedTouchesCoordinator && updatePayload.coordinator_id === undefined) {
        delete updatePayload.coordinator_id;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error } = await supabase.from('profiles').update(updatePayload).eq('id', id);
        if (error) throw error;
      }

      if (touchesTeam) {
        const expectedTeamId = handledTeamByRpc
          ? rpcNextTeamId
          : ((updatePayload.team_id ?? updatePayload.team ?? null) as string | null);

        const { data: persisted, error: persistedError } = await supabase
          .from('profiles')
          .select('team, team_id')
          .eq('id', id)
          .maybeSingle();

        if (persistedError) throw persistedError;

        const persistedTeamId = (persisted?.team_id ?? persisted?.team ?? null) as string | null;
        if (persistedTeamId !== expectedTeamId) {
          throw new Error('Falha ao persistir troca de equipe. Verifique permissões (RLS/RPC).');
        }
      }

      if (previousScope) {
        const previousTeamId = previousScope.team_id || previousScope.team || null;
        const nextTeamId = touchesTeam
          ? (handledTeamByRpc
            ? rpcNextTeamId
            : ((updatePayload.team_id ?? updatePayload.team ?? null) as string | null))
          : previousTeamId;

        const previousDirectorateId = previousScope.directorate_id ?? null;
        const nextDirectorateId = resolvedTouchesDirectorate
          ? ((updatePayload.directorate_id ?? null) as string | null)
          : previousDirectorateId;

        const previousManagerId = previousScope.manager_id ?? null;
        const nextManagerId = resolvedTouchesManager
          ? ((updatePayload.manager_id ?? null) as string | null)
          : previousManagerId;

        const previousCoordinatorId = previousScope.coordinator_id ?? null;
        const nextCoordinatorId = resolvedTouchesCoordinator
          ? ((updatePayload.coordinator_id ?? null) as string | null)
          : previousCoordinatorId;

        if (touchesTeam && previousTeamId !== nextTeamId) {
          const syncTeamMember = async (teamId: string | null, shouldAdd: boolean) => {
            if (!teamId) return;

            const { data: teamRow, error: teamError } = await supabase
              .from('teams')
              .select('members')
              .eq('id', teamId)
              .single();
            if (teamError) {
              console.warn(`Nao foi possivel sincronizar membros da equipe ${teamId}:`, teamError.message);
              return;
            }

            const currentMembers: string[] = Array.isArray(teamRow?.members)
              ? teamRow.members.filter((member: any) => typeof member === 'string')
              : [];

            const exists = currentMembers.includes(id);
            if (shouldAdd && exists) return;
            if (!shouldAdd && !exists) return;

            const nextMembers = shouldAdd
              ? [...currentMembers, id]
              : currentMembers.filter(memberId => memberId !== id);

            const { error: saveTeamError } = await supabase
              .from('teams')
              .update({ members: nextMembers })
              .eq('id', teamId);
            if (saveTeamError) {
              console.warn(`Nao foi possivel atualizar membros da equipe ${teamId}:`, saveTeamError.message);
            }
          };

          const cleanupDuplicatedMemberships = async (targetTeamId: string | null) => {
            const { data: teamRows, error: teamRowsError } = await supabase
              .from('teams')
              .select('id, members');

            if (teamRowsError) {
              console.warn('Nao foi possivel validar membros duplicados em equipes:', teamRowsError.message);
              return;
            }

            for (const row of (teamRows || []) as Array<any>) {
              const teamId = row?.id as string | undefined;
              if (!teamId || teamId === targetTeamId) continue;

              const members: string[] = Array.isArray(row?.members)
                ? row.members.filter((member: any) => typeof member === 'string')
                : [];

              if (!members.includes(id)) continue;

              const nextMembers = members.filter(memberId => memberId !== id);
              const { error: removeError } = await supabase
                .from('teams')
                .update({ members: nextMembers })
                .eq('id', teamId);

              if (removeError) {
                console.warn(`Nao foi possivel remover usuario da equipe antiga ${teamId}:`, removeError.message);
              }
            }
          };

          await syncTeamMember(previousTeamId, false);
          await syncTeamMember(nextTeamId, true);
          await cleanupDuplicatedMemberships(nextTeamId);
        }

        const hierarchyChanged =
          previousTeamId !== nextTeamId ||
          previousDirectorateId !== nextDirectorateId ||
          previousManagerId !== nextManagerId ||
          previousCoordinatorId !== nextCoordinatorId;

        if (hierarchyChanged) {
          const getProfileName = async (profileId: string | null): Promise<string | null> => {
            if (!profileId) return null;
            const { data: row } = await supabase.from('profiles').select('name').eq('id', profileId).single();
            return row?.name || null;
          };

          let teamName: string | null = nextTeamMeta?.name || null;
          if (!teamName && nextTeamId) {
            const { data: t } = await supabase.from('teams').select('name').eq('id', nextTeamId).single();
            teamName = t?.name || null;
          }

          let directorateName: string | null = null;
          if (nextDirectorateId) {
            const { data: d } = await supabase.from('directorates').select('name').eq('id', nextDirectorateId).single();
            directorateName = d?.name || null;
          }

          const managerName = await getProfileName(nextManagerId);
          const coordinatorName = await getProfileName(nextCoordinatorId);

          const ownershipCandidates: Array<{ table: string; ownerColumns: string[] }> = [
            { table: 'clients', ownerColumns: ['owner_id'] },
            { table: 'appointments', ownerColumns: ['owner_id', 'user_id', 'responsible_id', 'created_by'] },
            { table: 'tasks', ownerColumns: ['owner_id', 'user_id', 'responsible_id', 'created_by', 'assigned_to'] },
            { table: 'goals', ownerColumns: ['owner_id', 'created_by', 'user_id'] },
            { table: 'announcements', ownerColumns: ['owner_id', 'author_id', 'created_by', 'user_id'] },
            { table: 'developments', ownerColumns: ['owner_id', 'user_id', 'created_by'] },
            { table: 'notifications', ownerColumns: ['owner_id', 'user_id', 'created_by'] },
            { table: 'leads', ownerColumns: ['owner_id', 'assigned_to', 'user_id', 'created_by'] },
          ];

          const hierarchyFields: Array<{ value: string | null; columns: string[] }> = [
            { value: nextTeamId, columns: ['team_id', 'team'] },
            { value: teamName, columns: ['team_name', 'equipe_nome', 'equipe'] },
            { value: nextDirectorateId, columns: ['directorate_id', 'diretoria_id'] },
            { value: directorateName, columns: ['directorate_name', 'diretoria_nome', 'diretoria'] },
            { value: nextCoordinatorId, columns: ['coordinator_id', 'coordenador_id'] },
            { value: coordinatorName, columns: ['coordinator_name', 'coordenador_nome', 'coordenador'] },
            { value: nextManagerId, columns: ['manager_id', 'gerente_id'] },
            { value: managerName, columns: ['manager_name', 'gerente_nome', 'gerente'] },
          ];

          const isMissingColumnError = (message: string, column: string) =>
            message.includes('column') && message.includes(column.toLowerCase());

          for (const target of ownershipCandidates) {
            for (const ownerColumn of target.ownerColumns) {
              let ownerColumnUnavailable = false;

              for (const field of hierarchyFields) {
                let fieldPatched = false;

                for (const candidateColumn of field.columns) {
                  const { error: patchError } = await supabase
                    .from(target.table)
                    .update({ [candidateColumn]: field.value })
                    .eq(ownerColumn, id);

                  if (!patchError) {
                    fieldPatched = true;
                    break;
                  }

                  const lowerMsg = String(patchError.message || '').toLowerCase();
                  if (isMissingColumnError(lowerMsg, ownerColumn)) {
                    ownerColumnUnavailable = true;
                    break;
                  }

                  if (isMissingColumnError(lowerMsg, candidateColumn)) {
                    continue;
                  }

                  console.warn(`Nao foi possivel propagar hierarquia em ${target.table} via ${ownerColumn}/${candidateColumn}:`, patchError.message);
                  fieldPatched = true;
                  break;
                }

                if (ownerColumnUnavailable) {
                  break;
                }

                if (!fieldPatched) {
                  continue;
                }
              }

              if (!ownerColumnUnavailable) {
                break;
              }
            }
          }
        }
      }

      await refreshProfiles();
      // If the current user updated their own profile, refresh profile state so
      // chat UI reflects changes immediately without requiring a page reload.
      if (id === userRef.current?.id) {
        const { data: freshProfile } = await supabase.from('profiles').select('*').eq('id', id).single();
        if (freshProfile) setProfile(freshProfile as Profile);
      }
      logAuditEvent({
        action: data.role ? 'permissions_updated' : 'profile_updated',
        entity: 'profile',
        entityId: id,
        userId: userRef.current?.id || null,
        metadata: data
      });
    } catch (e) {
      console.error('Erro ao atualizar profile:', e);
      throw e;
    }
  }, [refreshProfiles]);

  const signOut = async () => {
    const uid = userRef.current?.id || null;
    await supabase.auth.signOut();
    localStorage.removeItem('isAuthenticated');
    logAuditEvent({ action: 'logout', entity: 'auth', userId: uid });
  };

  // ─── Clients ──────────────────────────────────────────────────────────────

  const refreshLeads = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      // Silently skip if DB error (e.g. column not yet migrated)
      if (error) { console.warn('refreshLeads skipped:', error.message); return; }

      const rawRole = profileRef.current?.role || userRoleRef.current || 'CORRETOR';
      const role = String(rawRole).toUpperCase();
      const uid = userRef.current?.id;

      const filtered = (data || []).filter((lead: any) => {
        // Hide converted leads (client-side, only if column exists)
        if (lead.stage && lead.stage !== 'novo_lead') return false;
        // RBAC filter client-side
        if (role === 'ADMIN') return true;
        if (role === 'CORRETOR') return !lead.assigned_to || lead.assigned_to === uid;
        if ((role === 'GERENTE' || role === 'COORDENADOR' || role === 'DIRETOR') && profileRef.current?.directorate_id) {
          return !lead.directorate_id || lead.directorate_id === profileRef.current.directorate_id;
        }
        return true;
      });

      const transformed: AutomationLead[] = filtered.map((lead: any) => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        origin: lead.origin,
        timestamp: lead.created_at,
        aiSummary: lead.ai_summary,
        interestLevel: lead.interest_level,
        stage: lead.stage,
        assigned_to: lead.assigned_to,
        distribution_status: lead.distribution_status,
        ai_metadata: lead.ai_metadata,
        viewed_at: lead.viewed_at,
        converted_at: lead.converted_at,
        client_id: lead.client_id,
        directorate_id: lead.directorate_id,
        data: lead.ai_metadata || lead.data,
      }));
      setLeads(transformed);
    } catch (e) { console.error('Erro ao carregar leads:', e); }
  }, []);

  const updateLead = useCallback(async (id: string, data: Partial<AutomationLead>) => {
    try {
      const dbData: any = {};
      if (data.stage !== undefined) dbData.stage = data.stage;
      if (data.assigned_to !== undefined) dbData.assigned_to = data.assigned_to;
      if (data.distribution_status !== undefined) dbData.distribution_status = data.distribution_status;
      if (data.viewed_at !== undefined) dbData.viewed_at = data.viewed_at;
      if (data.converted_at !== undefined) dbData.converted_at = data.converted_at;
      if (data.client_id !== undefined) dbData.client_id = data.client_id;
      if (data.name !== undefined) dbData.name = data.name;
      const { error } = await supabase.from('leads').update(dbData).eq('id', id);
      if (error) throw error;
      await refreshLeads();
    } catch (e) { console.error('Erro ao atualizar lead:', e); }
  }, [refreshLeads]);



  const refreshClients = useCallback(async () => {
    try {
      const rawRole = profileRef.current?.role || userRoleRef.current || 'CORRETOR';
      const role = String(rawRole).toUpperCase();
      const uid = userRef.current?.id;

      try {
        await rateLimiter.enforce('clients_query', { userId: uid || null });
      } catch (err: any) {
        alert(err?.message || 'Limite de consultas atingido. Aguarde um minuto.');
        return;
      }

      let query = supabase
        .from('clients')
        .select('*, history:client_history(*), documents:client_documents(*), proponents:client_proponents(*)')
        .order('created_at', { ascending: false });

      if (uid && role === 'CORRETOR') {
        query = query.eq('owner_id', uid);
      } else if (uid && role === 'COORDENADOR') {
        const { data: directMembers } = await supabase
          .from('profiles').select('id').eq('coordinator_id', uid);
        const memberIds = (directMembers || []).map((p: any) => p.id);
        const ownerIds = [...new Set([...memberIds, uid])];
        query = query.in('owner_id', ownerIds);
      }
      // GERENTE / ADMIN / DIRETOR: sem filtro JS — o RLS (manager_view_team_clients) garante visibilidade correta

      const { data, error } = await query;
      if (error) throw error;
      const transformed = (data || []).map(client => ({
        ...client,
        grossIncome: client.gross_income, incomeType: client.income_type,
        socialFactor: client.social_factor, regionOfInterest: client.region_of_interest,
        intendedValue: client.intended_value, createdAt: client.created_at,
        closed_at: client.closed_at,
        updated_at: client.updated_at,
        history: (client.history || []).map((h: any) => ({ ...h, user: h.user_name }))
          .map((h: any) => ({
            ...h,
            date: h.date || (h.created_at ? new Date(h.created_at).toLocaleDateString('pt-BR') : ''),
          }))
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        documents: (client.documents || []).map((d: any) => ({ ...d, file_path: d.url || d.file_path, uploadDate: d.upload_date })),
        proponents: (client.proponents || [])
          .map((p: any) => ({
            id: p.id,
            clientId: p.client_id,
            name: p.name,
            cpf: p.cpf,
            email: p.email,
            phone: p.phone,
            address: p.address,
            profession: p.profession,
            grossIncome: p.gross_income,
            incomeType: p.income_type,
            cotista: p.cotista,
            socialFactor: p.social_factor,
            isPrimary: p.is_primary,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          }))
          .sort((a: any, b: any) => {
            if (!!a.isPrimary !== !!b.isPrimary) return a.isPrimary ? -1 : 1;
            return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          }),
      }));
      setClients(transformed);
    } catch (e) { console.error('Erro ao carregar clientes:', e); }
  }, []);

  const convertLeadToClient = useCallback(async (leadId: string, clientData: any): Promise<{ success: boolean; clientId?: string }> => {
    try {
      const { data: newClient, error: clientError } = await supabase.from('clients').insert([{
        name: clientData.name,
        phone: clientData.phone,
        cpf: clientData.cpf || null,
        email: clientData.email || null,
        profession: clientData.profession || null,
        gross_income: clientData.grossIncome || null,
        income_type: clientData.incomeType || null,
        region_of_interest: clientData.regionOfInterest || null,
        intended_value: clientData.intendedValue || null,
        observations: clientData.observations || null,
        stage: clientData.stage || 'Em Análise',
        owner_id: user?.id,
        directorate_id: profile?.directorate_id || null,
      }]).select().single();
      if (clientError) throw clientError;

      const now = new Date().toISOString();
      const { error: leadError } = await supabase.from('leads').update({
        stage: 'convertido',
        client_id: newClient.id,
        converted_at: now,
      }).eq('id', leadId);
      if (leadError) throw leadError;

      await Promise.all([refreshLeads(), refreshClients()]);
      const actingUser = userRef.current?.id || null;
      logAuditEvent({
        action: 'client_created',
        entity: 'client',
        entityId: newClient.id,
        userId: actingUser,
        metadata: { source: 'lead_conversion' }
      });
      logAuditEvent({
        action: 'lead_converted',
        entity: 'lead',
        entityId: leadId,
        userId: actingUser,
        metadata: { client_id: newClient.id }
      });
      return { success: true, clientId: newClient.id };
    } catch (e: any) {
      console.error('Erro ao converter lead:', e);
      return { success: false };
    }
  }, [user, profile, refreshLeads, refreshClients]);

  const addClient = useCallback(async (data: Omit<Client, 'id' | 'history' | 'documents' | 'createdAt'>): Promise<Client | null> => {
    try {
      const insertPayload: any = {
        name: data.name, cpf: data.cpf, email: data.email, phone: data.phone,
        address: data.address, profession: data.profession, gross_income: data.grossIncome,
        income_type: data.incomeType, cotista: data.cotista, social_factor: data.socialFactor,
        region_of_interest: data.regionOfInterest, development: data.development,
        builder: data.builder || null, neighborhood: data.neighborhood || null,
        intended_value: data.intendedValue, observations: data.observations, stage: data.stage,
        owner_id: user?.id, directorate_id: profile?.directorate_id || null
      };
      let { data: newClient, error } = await supabase.from('clients').insert([insertPayload]).select().single();
      // Resiliência: se as colunas "builder"/"neighborhood" ainda não foram migradas, tenta sem elas
      if (error && (error.code === '42703' || /builder|neighborhood/i.test(error.message || ''))) {
        delete insertPayload.builder;
        delete insertPayload.neighborhood;
        ({ data: newClient, error } = await supabase.from('clients').insert([insertPayload]).select().single());
      }
      if (error) throw error;
      await supabase.from('client_history').insert([{ client_id: newClient.id, action: 'Cliente criado', user_name: userName }]);
      await refreshClients();
      logAuditEvent({
        action: 'client_created',
        entity: 'client',
        entityId: newClient.id,
        userId: user?.id || null,
        metadata: { stage: data.stage }
      });
      return newClient;
    } catch (e: any) { console.error('Erro ao adicionar cliente:', e); throw e; }
  }, [userName, refreshClients, user, profile]);

  const updateClient = useCallback(async (id: string, data: Partial<Client>) => {
    // Update otimista: reflete a mudança na UI imediatamente (ex.: arrastar card no Kanban
    // para outra etapa) antes de aguardar a rede. Em caso de erro, refreshClients reverte.
    setClients(prev => prev.map(c => (c.id === id ? { ...c, ...data } : c)));
    try {
      const allowedFields = [
        'name', 'cpf', 'email', 'phone', 'address', 'profession',
        'gross_income', 'income_type', 'cotista', 'social_factor', 'region_of_interest',
        'development', 'builder', 'neighborhood', 'intended_value', 'observations', 'stage'
      ];

      const updatePayload: any = {};
      Object.keys(data).forEach(key => {
        if (allowedFields.includes(key)) {
          updatePayload[key] = data[key as keyof Client];
        }
      });

      if (data.grossIncome !== undefined) updatePayload.gross_income = data.grossIncome;
      if (data.incomeType !== undefined) updatePayload.income_type = data.incomeType;
      if (data.socialFactor !== undefined) updatePayload.social_factor = data.socialFactor;
      if (data.regionOfInterest !== undefined) updatePayload.region_of_interest = data.regionOfInterest;
      if (data.intendedValue !== undefined) updatePayload.intended_value = data.intendedValue;

      let { data: updated, error } = await supabase
        .from('clients')
        .update(updatePayload)
        .eq('id', id)
        .select('id');
      // Resiliência: se as colunas "builder"/"neighborhood" ainda não existirem, refaz sem elas
      if (error && (error.code === '42703' || /builder|neighborhood/i.test(error.message || ''))) {
        delete updatePayload.builder;
        delete updatePayload.neighborhood;
        ({ data: updated, error } = await supabase.from('clients').update(updatePayload).eq('id', id).select('id'));
      }
      if (error) throw error;
      if (!updated || updated.length === 0) {
        throw new Error('Sem permissão para alterar este cliente. Verifique suas permissões de acesso.');
      }
      if (data.stage) {
        const { error: historyError } = await supabase
          .from('client_history')
          .insert([{ client_id: id, action: `Estágio alterado para ${data.stage}`, user_name: userName }]);

        if (historyError) {
          console.error('Erro ao registrar histórico do cliente:', historyError);
        }
      }
      await refreshClients();
      logAuditEvent({
        action: 'client_updated',
        entity: 'client',
        entityId: id,
        userId: userRef.current?.id || null,
        metadata: { fields: Object.keys(updatePayload) }
      });
    } catch (e) {
      console.error('Erro ao atualizar cliente:', e);
      await refreshClients(); // reverte o update otimista para o estado real do servidor
      throw e; // re-throw so callers can handle/show error
    }
  }, [userName, refreshClients]);

  const deleteClient = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      await refreshClients();
      logAuditEvent({ action: 'client_deleted', entity: 'client', entityId: id, userId: userRef.current?.id || null });
    } catch (e) { console.error('Erro ao deletar cliente:', e); }
  }, [refreshClients]);

  const addClientProponent = useCallback(async (
    clientId: string,
    data: Omit<ClientProponent, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const payload = {
        client_id: clientId,
        name: (data.name || '').trim(),
        cpf: data.cpf?.trim() || null,
        email: data.email?.trim() || null,
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        profession: data.profession?.trim() || null,
        gross_income: data.grossIncome?.trim() || null,
        income_type: data.incomeType?.trim() || null,
        cotista: data.cotista?.trim() || null,
        social_factor: data.socialFactor?.trim() || null,
        is_primary: !!data.isPrimary,
      };

      if (!payload.name) {
        return { success: false, error: 'Nome do proponente é obrigatório.' };
      }

      const { error } = await supabase.from('client_proponents').insert([payload]);
      if (error) return { success: false, error: error.message };

      await refreshClients();
      logAuditEvent({
        action: 'client_proponent_added',
        entity: 'client',
        entityId: clientId,
        userId: userRef.current?.id || null,
        metadata: { name: payload.name }
      });

      return { success: true };
    } catch (e: any) {
      console.error('Erro ao adicionar proponente:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  }, [refreshClients]);

  const updateClientProponent = useCallback(async (
    id: string,
    data: Partial<Omit<ClientProponent, 'id' | 'clientId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const payload: any = {};
      if (data.name !== undefined) payload.name = data.name.trim();
      if (data.cpf !== undefined) payload.cpf = data.cpf?.trim() || null;
      if (data.email !== undefined) payload.email = data.email?.trim() || null;
      if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
      if (data.address !== undefined) payload.address = data.address?.trim() || null;
      if (data.profession !== undefined) payload.profession = data.profession?.trim() || null;
      if (data.grossIncome !== undefined) payload.gross_income = data.grossIncome?.trim() || null;
      if (data.incomeType !== undefined) payload.income_type = data.incomeType?.trim() || null;
      if (data.cotista !== undefined) payload.cotista = data.cotista?.trim() || null;
      if (data.socialFactor !== undefined) payload.social_factor = data.socialFactor?.trim() || null;
      if (data.isPrimary !== undefined) payload.is_primary = !!data.isPrimary;

      if (payload.name !== undefined && !payload.name) {
        return { success: false, error: 'Nome do proponente é obrigatório.' };
      }

      const { error } = await supabase.from('client_proponents').update(payload).eq('id', id);
      if (error) return { success: false, error: error.message };

      await refreshClients();
      logAuditEvent({
        action: 'client_proponent_updated',
        entity: 'client',
        entityId: id,
        userId: userRef.current?.id || null,
      });

      return { success: true };
    } catch (e: any) {
      console.error('Erro ao atualizar proponente:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  }, [refreshClients]);

  const deleteClientProponent = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.from('client_proponents').delete().eq('id', id);
      if (error) return { success: false, error: error.message };

      await refreshClients();
      logAuditEvent({
        action: 'client_proponent_deleted',
        entity: 'client',
        entityId: id,
        userId: userRef.current?.id || null,
      });

      return { success: true };
    } catch (e: any) {
      console.error('Erro ao remover proponente:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  }, [refreshClients]);

  const getClient = useCallback((id: string) => clients.find(c => c.id === id), [clients]);

  // ─── Storage ──────────────────────────────────────────────────────────────

  const uploadFile = async (file: File, path: string, bucket = 'documents'): Promise<string | null> => {
    const targetBucket = bucket || 'documents';
    try {
      if (targetBucket === 'client-documents') {
        try {
          await rateLimiter.enforce('document_upload', { userId: userRef.current?.id || null });
        } catch (err: any) {
          alert(err?.message || 'Limite de upload atingido. Aguarde instantes e tente novamente.');
          return null;
        }
      }

      // Remove accents and special characters to prevent Supabase Storage "Invalid key" errors
      const sanitizedPath = path.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.\-_/]/g, '_');
      const { data, error } = await supabase.storage.from(targetBucket).upload(sanitizedPath, file, {
        upsert: targetBucket === 'client-documents' ? false : true,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      return data.path;
    } catch (e: any) {
      console.error('Erro no upload Storage:', e.message || e);
      throw new Error(e?.message || 'Erro ao enviar arquivo');
    }
  };

  const addDocumentToClient = async (clientId: string, name: string, path: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.from('client_documents').insert([{
        client_id: clientId,
        name,
        url: path,
        created_by: userRef.current?.id || null,
      }]);
      if (error) return { success: false, error: error.message };

      await refreshClients();
      logAuditEvent({
        action: 'document_uploaded',
        entity: 'client_document',
        entityId: clientId,
        userId: userRef.current?.id || null,
        metadata: { name, path }
      });
      return { success: true };
    } catch (e: any) {
      console.error('Erro ao adicionar documento:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  };

  const deleteDocumentFromClient = async (docId: string, filePath?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      // First delete from storage if a file path is provided
      if (filePath) {
        // Strip out the leading folder name if the storage API expects only the file name or bucket logic varies,
        // but typically path includes folder/filename.
        await supabase.storage.from('client-documents').remove([filePath]);
      }

      // Then delete from database
      const { error } = await supabase.from('client_documents').delete().eq('id', docId);
      if (error) return { success: false, error: error.message };

      await refreshClients();
      logAuditEvent({
        action: 'document_deleted',
        entity: 'client_document',
        entityId: docId,
        userId: userRef.current?.id || null,
        metadata: { path: filePath }
      });
      return { success: true };
    } catch (e: any) {
      console.error('Erro ao deletar documento:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  };

  const renameClientDocument = async (docId: string, name: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase
        .from('client_documents')
        .update({ name })
        .eq('id', docId)
        .select('id');
      if (error) return { success: false, error: error.message };
      if (!data || data.length === 0) {
        return { success: false, error: 'Sem permissão para renomear este documento.' };
      }

      await refreshClients();
      logAuditEvent({
        action: 'document_renamed',
        entity: 'client_document',
        entityId: docId,
        userId: userRef.current?.id || null,
        metadata: { name },
      });
      return { success: true };
    } catch (e: any) {
      console.error('Erro ao renomear documento:', e);
      return { success: false, error: e.message || 'Erro desconhecido' };
    }
  };

  const getDownloadUrl = async (path: string, bucket = 'documents'): Promise<string | null> => {
    // C-07: client-documents must go through get-doc-url-v2 Edge Function (RLS + audit).
    if (bucket === 'client-documents') {
      console.error('[getDownloadUrl] client-documents bucket requires get-doc-url-v2 Edge Function.');
      throw new Error('Use get-doc-url-v2 for client documents.');
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    if (error) { console.error('Erro ao gerar link:', error); return null; }
    return data.signedUrl;
  };

  // ─── Appointments ─────────────────────────────────────────────────────────

  const refreshAppointments = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('appointments').select('*').order('date').order('time');
      if (error) throw error;
      setAppointments(data || []);
    } catch (e) { console.error('Erro ao buscar agendamentos:', e); }
  }, []);

  const addAppointment = useCallback(async (data: Omit<Appointment, 'id' | 'created_at'>) => {
    try {
      const { data: newRow, error } = await supabase.from('appointments').insert([{
        ...data,
        owner_id: user?.id,
        directorate_id: profile?.directorate_id || null
      }]).select().single();
      if (error) throw error;
      await refreshAppointments();
    } catch (e: any) {
      console.error('Erro ao adicionar agendamento:', e);
      throw e;
    }
  }, [refreshAppointments, user, profile]);

  const updateAppointment = useCallback(async (id: string, data: Partial<Appointment>) => {
    try {
      const { error } = await supabase.from('appointments').update(data).eq('id', id);
      if (error) throw error;
      await refreshAppointments();
    } catch (e) { console.error('Erro ao atualizar agendamento:', e); }
  }, [refreshAppointments]);

  const deleteAppointment = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw error;
      await refreshAppointments();
    } catch (e: any) {
      console.error('Erro ao deletar agendamento:', e);
      throw e;
    }
  }, [refreshAppointments]);

  // ─── Tasks ────────────────────────────────────────────────────────────────

  const refreshTasks = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const normalizedTasks = (data || []).map((task: any) => {
        let subtasks = task?.subtasks ?? task?.subtask ?? task?.sub_tasks;

        const parseMaybeJson = (value: unknown) => {
          if (typeof value !== 'string') return value;
          try {
            return JSON.parse(value);
          } catch {
            return value;
          }
        };

        subtasks = parseMaybeJson(subtasks);
        subtasks = parseMaybeJson(subtasks);

        if (!Array.isArray(subtasks) && subtasks && typeof subtasks === 'object') {
          const maybeArray = (subtasks as any).items ?? (subtasks as any).subtasks ?? (subtasks as any).data;
          subtasks = Array.isArray(maybeArray) ? maybeArray : [];
        }

        if (!Array.isArray(subtasks)) subtasks = [];

        subtasks = subtasks
          .map((s: any, idx: number) => ({
            id: String(s?.id ?? `${task?.id || 'task'}-${idx}`),
            title: String(s?.title ?? s?.name ?? s?.label ?? ''),
            completed: Boolean(s?.completed ?? s?.done ?? s?.is_done ?? false),
          }))
          .filter((s: any) => s.title.trim().length > 0);

        return {
          ...task,
          subtasks,
        };
      });

      setTasks(normalizedTasks);
    } catch (e) { console.error('Erro ao buscar tarefas:', e); }
  }, []);

  const addTask = useCallback(async (data: Omit<Task, 'id' | 'created_at'>) => {
    try {
      const normalizedSubtasks = Array.isArray((data as any).subtasks) ? (data as any).subtasks : [];
      const basePayload = {
        ...data,
        subtasks: normalizedSubtasks,
        directorate_id: profile?.directorate_id || null
      };

      let { error } = await supabase.from('tasks').insert([{
        ...basePayload,
        owner_id: user?.id,
        created_by: user?.id,
        assigned_to: data.assigned_to || user?.id,
        assigned_by_role: profile?.role || null,
        assignment_scope: data.assignment_scope || 'INDIVIDUAL'
      }]);

      if (error?.message?.toLowerCase().includes('owner_id')) {
        const retry = await supabase.from('tasks').insert([{
          ...basePayload,
          user_id: user?.id,
          created_by: user?.id,
          assigned_to: data.assigned_to || user?.id,
          assigned_by_role: profile?.role || null,
          assignment_scope: data.assignment_scope || 'INDIVIDUAL'
        }]);
        error = retry.error;
      }

      if (error) throw error;
      await refreshTasks();
    } catch (e: any) {
      console.error('Erro ao adicionar tarefa:', e);
      throw e;
    }
  }, [refreshTasks, user, profile]);

  const updateTask = useCallback(async (id: string, data: Partial<Task>) => {
    try {
      const normalizedSubtasks = Array.isArray((data as any).subtasks) ? (data as any).subtasks : undefined;
      const payload: Partial<Task> = {
        ...data,
        ...(normalizedSubtasks ? {
          subtasks: normalizedSubtasks,
        } : {}),
      };
      delete (payload as any).id;
      if (data.status === 'Concluída') {
        payload.completed_at = new Date().toISOString();
      } else if (data.status) {
        payload.completed_at = null;
      } else {
        delete payload.completed_at;
      }
      const { error } = await supabase.from('tasks').update(payload).eq('id', id);
      if (error) throw error;
      await refreshTasks();
    } catch (e: any) {
      console.error('Erro ao atualizar tarefa:', e);
      throw e;
    }
  }, [refreshTasks]);

  const deleteTask = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      await refreshTasks();
    } catch (e: any) {
      console.error('Erro ao deletar tarefa:', e);
      throw e;
    }
  }, [refreshTasks]);

  // ─── Developments ─────────────────────────────────────────────────────────

  const refreshDevelopments = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('developments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setDevelopments(data || []);
    } catch (e) { console.error('Erro ao buscar empreendimentos:', e); }
  }, []);

  const addDevelopment = useCallback(async (data: Omit<Development, 'id' | 'created_at'>): Promise<Development | null> => {
    try {
      const { data: newDev, error } = await supabase.from('developments').insert([{
        ...data,
        user_id: user?.id,
        directorate_id: profile?.directorate_id || null
      }]).select().single();
      if (error) throw error;
      await refreshDevelopments();
      return newDev;
    } catch (e) { console.error('Erro ao adicionar empreendimento:', e); return null; }
  }, [refreshDevelopments, user, profile]);

  const updateDevelopment = useCallback(async (id: string, data: Partial<Development>) => {
    try {
      const { error } = await supabase.from('developments').update(data).eq('id', id);
      if (error) throw error;
      await refreshDevelopments();
    } catch (e) { console.error('Erro ao atualizar empreendimento:', e); }
  }, [refreshDevelopments]);

  const deleteDevelopment = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('developments').delete().eq('id', id);
      if (error) throw error;
      await refreshDevelopments();
    } catch (e) { console.error('Erro ao deletar empreendimento:', e); }
  }, [refreshDevelopments]);

  // ─── Teams ────────────────────────────────────────────────────────────────

  const refreshTeams = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('teams').select('*').order('name');
      if (error) throw error;
      setTeams(data || []);
    } catch (e) { console.error('Erro ao buscar equipes:', e); }
  }, []);

  const addTeam = useCallback(async (data: Omit<Team, 'id'>) => {
    try {
      const { error } = await supabase.from('teams').insert([{
        name: data.name,
        manager_id: data.manager_id || null,
        directorate_id: data.directorate_id || null,
        members: data.members || []
      }]);
      if (error) throw error;
      await refreshTeams();
    } catch (e) {
      console.error('Erro ao adicionar equipe:', e);
      throw e; // propagate up to UI
    }
  }, [refreshTeams]);

  const updateTeam = useCallback(async (id: string, data: Partial<Team>) => {
    try {
      const { data: previousTeam, error: previousTeamError } = await supabase
        .from('teams')
        .select('manager_id, directorate_id, members')
        .eq('id', id)
        .single();
      if (previousTeamError) throw previousTeamError;

      const updateData: any = { ...data };
      if ('directorate_id' in data) updateData.directorate_id = data.directorate_id ? data.directorate_id : null;
      if ('manager_id' in data) updateData.manager_id = data.manager_id ? data.manager_id : null;

      const { error } = await supabase.from('teams').update(updateData).eq('id', id);
      if (error) throw error;

      if ('manager_id' in data) {
        const previousManagerId = previousTeam?.manager_id || null;
        const nextManagerId = updateData.manager_id || null;
        const nextDirectorateId = ('directorate_id' in updateData)
          ? updateData.directorate_id
          : (previousTeam?.directorate_id || null);

        const currentMembers: string[] = Array.isArray(previousTeam?.members)
          ? previousTeam.members.filter((member: any) => typeof member === 'string')
          : [];

        const syncManagerMembership = async (managerId: string | null) => {
          if (!managerId) return;

          await supabase
            .from('profiles')
            .update({
              team: id,
              team_id: id,
              directorate_id: nextDirectorateId,
              coordinator_id: null,
            })
            .eq('id', managerId);

          const { data: allTeamRows } = await supabase
            .from('teams')
            .select('id, members');

          for (const row of (allTeamRows || []) as Array<any>) {
            const teamId = row?.id as string | undefined;
            if (!teamId || teamId === id) continue;
            const members: string[] = Array.isArray(row?.members)
              ? row.members.filter((member: any) => typeof member === 'string')
              : [];
            if (!members.includes(managerId)) continue;

            await supabase
              .from('teams')
              .update({ members: members.filter(memberId => memberId !== managerId) })
              .eq('id', teamId);
          }

          if (!currentMembers.includes(managerId)) {
            await supabase
              .from('teams')
              .update({ members: [...currentMembers, managerId] })
              .eq('id', id);
          }
        };

        if (nextManagerId && nextManagerId !== previousManagerId) {
          await syncManagerMembership(nextManagerId);
        }

        if (previousManagerId && previousManagerId !== nextManagerId) {
          const { data: prevProfile } = await supabase
            .from('profiles')
            .select('team, team_id')
            .eq('id', previousManagerId)
            .single();

          if ((prevProfile?.team_id || prevProfile?.team) === id) {
            await supabase
              .from('profiles')
              .update({ team: null, team_id: null })
              .eq('id', previousManagerId);
          }
        }
      }

      await refreshTeams();
      await refreshProfiles();
    } catch (e) {
      console.error('Erro ao atualizar equipe:', e);
      throw e;
    }
  }, [refreshProfiles, refreshTeams]);

  const deleteTeam = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('teams').delete().eq('id', id);
      if (error) throw error;
      await refreshTeams();
    } catch (e) { console.error('Erro ao deletar equipe:', e); }
  }, [refreshTeams]);

  // ─── Goals ────────────────────────────────────────────────────────────────

  const refreshGoals = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('goals').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setGoals(data || []);
    } catch (e) { console.error('Erro ao buscar metas:', e); }
  }, []);

  // ─── Goals Realtime (auto-refresh when trigger updates progress) ──────────
  React.useEffect(() => {
    if (!user) return;
    const goalsChannel = supabase.channel('public:goals:realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, () => {
        refreshGoals();
      })
      .subscribe();
    return () => { supabase.removeChannel(goalsChannel); };
  }, [user, refreshGoals]);


  const addGoal = useCallback(async (data: Omit<Goal, 'id'> & { directorate_id?: string | null }) => {
    try {
      const basePayload = {
        ...data,
        directorate_id: data.directorate_id !== undefined ? data.directorate_id : (profile?.directorate_id || null)
      };

      let { error } = await supabase.from('goals').insert([{
        ...basePayload,
        owner_id: user?.id
      }]);

      if (error?.message?.toLowerCase().includes('owner_id')) {
        const retryCreatedBy = await supabase.from('goals').insert([{
          ...basePayload,
          created_by: user?.id
        }]);
        error = retryCreatedBy.error;
      }

      if (error?.message?.toLowerCase().includes('created_by')) {
        const retryUser = await supabase.from('goals').insert([{
          ...basePayload,
          user_id: user?.id
        }]);
        error = retryUser.error;
      }

      if (error) throw error;
      await refreshGoals();
    } catch (e: any) {
      console.error('Erro ao adicionar meta:', e);
      throw e;
    }
  }, [refreshGoals, user, profile]);

  const updateGoal = useCallback(async (id: string, data: Partial<Goal>) => {
    try {
      const { error } = await supabase.from('goals').update(data).eq('id', id);
      if (error) throw error;
      await refreshGoals();
    } catch (e: any) {
      console.error('Erro ao atualizar meta:', e);
      throw e;
    }
  }, [refreshGoals]);

  const deleteGoal = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('goals').delete().eq('id', id);
      if (error) throw error;
      await refreshGoals();
    } catch (e: any) {
      console.error('Erro ao deletar meta:', e);
      throw e;
    }
  }, [refreshGoals]);

  // ─── Announcements ────────────────────────────────────────────────────────

  const refreshAnnouncements = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setAnnouncements(data || []);
    } catch (e) { console.error('Erro ao buscar anúncios:', e); }
  }, []);

  const addAnnouncement = useCallback(async (data: Omit<Announcement, 'id' | 'created_at'>) => {
    try {
      const basePayload = {
        ...data,
        author_id: user?.id,
        assignee_type: data.assignee_type || 'All',
        assignee_id: data.assignee_type && data.assignee_type !== 'All' ? data.assignee_id || null : null,
        directorate_id: data.directorate_id !== undefined ? data.directorate_id : (profile?.directorate_id || null)
      };

      let { error } = await supabase.from('announcements').insert([{
        ...basePayload,
        owner_id: user?.id
      }]);

      if (error?.message?.toLowerCase().includes('owner_id')) {
        const retryNoOwner = await supabase.from('announcements').insert([basePayload]);
        error = retryNoOwner.error;
      }

      if (error) throw error;
      await refreshAnnouncements();
      logAuditEvent({
        action: 'announcement_created',
        entity: 'announcement',
        metadata: { title: data.title, assignee_type: data.assignee_type },
      });
    } catch (e: any) {
      console.error('Erro ao adicionar anúncio:', e);
      throw e;
    }
  }, [refreshAnnouncements, user, profile]);

  const updateAnnouncement = useCallback(async (id: string, data: Partial<Announcement>) => {
    try {
      const { error } = await supabase.from('announcements').update(data).eq('id', id);
      if (error) throw error;
      await refreshAnnouncements();
      logAuditEvent({ action: 'announcement_updated', entity: 'announcement', entityId: id });
    } catch (e: any) {
      console.error('Erro ao atualizar anúncio:', e);
      throw e;
    }
  }, [refreshAnnouncements]);

  const deleteAnnouncement = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
      await refreshAnnouncements();
      logAuditEvent({ action: 'announcement_deleted', entity: 'announcement', entityId: id });
    } catch (e: any) {
      console.error('Erro ao deletar anúncio:', e);
      throw e;
    }
  }, [refreshAnnouncements]);

  // ─── Directorates ─────────────────────────────────────────────

  const refreshDirectorates = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('directorates').select('*').order('name');
      if (error) throw error;
      setDirectorates(data || []);
    } catch (e) { console.error('Erro ao carregar diretorias:', e); }
  }, []);

  const addDirectorate = useCallback(async (data: Omit<Directorate, 'id'>) => {
    try {
      const { error } = await supabase.from('directorates').insert([{
        name: data.name,
        description: data.description,
        manager_id: data.manager_id || null
      }]);
      if (error) throw error;
      await refreshDirectorates();
    } catch (e) {
      console.error('Erro ao adicionar diretoria:', e);
      throw e;
    }
  }, [refreshDirectorates]);

  const updateDirectorate = useCallback(async (id: string, data: Partial<Directorate>) => {
    try {
      const updateData: any = { ...data };
      if ('manager_id' in data) updateData.manager_id = data.manager_id ? data.manager_id : null;

      const { error } = await supabase.from('directorates').update(updateData).eq('id', id);
      if (error) throw error;
      await refreshDirectorates();
    } catch (e) {
      console.error('Erro ao atualizar diretoria:', e);
      throw e;
    }
  }, [refreshDirectorates]);

  const deleteDirectorate = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('directorates').delete().eq('id', id);
      if (error) throw error;
      await refreshDirectorates();
    } catch (e) { console.error('Erro ao deletar diretoria:', e); }
  }, [refreshDirectorates]);

  // ─── Portals ──────────────────────────────────────────────────────────────

  const refreshPortals = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('portals').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setPortals(data || []);
    } catch (e) { console.error('Erro ao buscar portais:', e); }
  }, []);

  const addPortal = useCallback(async (data: Omit<Portal, 'id' | 'created_at'>) => {
    try {
      const { error } = await supabase.from('portals').insert([{ ...data, created_by: user?.id }]);
      if (error) throw error;
      await refreshPortals();
    } catch (e) { console.error('Erro ao criar portal:', e); }
  }, [refreshPortals, user]);

  const updatePortal = useCallback(async (id: string, data: Partial<Portal>) => {
    try {
      const { error } = await supabase.from('portals').update(data).eq('id', id);
      if (error) throw error;
      await refreshPortals();
    } catch (e) { console.error('Erro ao atualizar portal:', e); }
  }, [refreshPortals]);

  const deletePortal = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('portals').delete().eq('id', id);
      if (error) throw error;
      await refreshPortals();
    } catch (e) { console.error('Erro ao deletar portal:', e); }
  }, [refreshPortals]);

  // ─── Trainings ────────────────────────────────────────────────────────────

  const refreshTrainings = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('trainings').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      let completionsMap: Record<string, boolean> = {};
      if (user) {
        const { data: compData, error: compError } = await supabase
          .from('training_completions')
          .select('training_id')
          .eq('user_id', user.id);

        if (!compError && compData) {
          compData.forEach(c => {
            completionsMap[c.training_id] = true;
          });
        }
      }

      const transformed = (data || []).map(t => ({
        ...t,
        progress: completionsMap[t.id] ? 100 : 0
      }));
      setTrainings(transformed);
    } catch (e) { console.error('Erro ao buscar treinamentos:', e); }
  }, [user]);

  const addTraining = useCallback(async (data: Omit<TrainingItem, 'id' | 'created_at'>) => {
    try {
      let { error } = await supabase.from('trainings').insert([{ ...data, created_by: user?.id }]);

      if (error?.message?.toLowerCase().includes('created_by')) {
        const retryUser = await supabase.from('trainings').insert([{ ...data, user_id: user?.id }]);
        error = retryUser.error;
      }

      if (error?.message?.toLowerCase().includes('user_id')) {
        const retryOwner = await supabase.from('trainings').insert([{ ...data, owner_id: user?.id }]);
        error = retryOwner.error;
      }

      if (error) throw error;
      await refreshTrainings();
    } catch (e: any) {
      console.error('Erro ao criar treinamento:', e);
      throw e;
    }
  }, [refreshTrainings, user]);

  const updateTraining = useCallback(async (id: string, data: Partial<TrainingItem>) => {
    try {
      const { error } = await supabase.from('trainings').update(data).eq('id', id);
      if (error) throw error;
      await refreshTrainings();
    } catch (e: any) {
      console.error('Erro ao atualizar treinamento:', e);
      throw e;
    }
  }, [refreshTrainings]);

  const deleteTraining = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('trainings').delete().eq('id', id);
      if (error) throw error;
      await refreshTrainings();
    } catch (e: any) {
      console.error('Erro ao deletar treinamento:', e);
      throw e;
    }
  }, [refreshTrainings]);

  const completeTraining = useCallback(async (id: string) => {
    try {
      if (!user) return;
      // We do a direct insert. If it fails due to UNIQUE constraint, it just means they already completed it.
      const { error } = await supabase.from('training_completions').insert({
        user_id: user.id,
        training_id: id
      });
      // We don't throw error if it's a conflict (23505) because the user already completed it
      if (error && error.code !== '23505') {
        console.error('Erro ao concluir treinamento:', error);
      } else {
        // Refresh to reflect the 100% completion status
        await refreshTrainings();
      }
    } catch (e) {
      console.error('Erro ao registrar conclusão do treinamento:', e);
    }
  }, [user, refreshTrainings]);

  // ─── Init ─────────────────────────────────────────────────────────────────

  const loadAllData = useCallback(async (forcedProfile?: Profile) => {
    if (forcedProfile) {
      profileRef.current = forcedProfile;
      userRoleRef.current = forcedProfile.role || 'Corretor';
    }
    try {
      await Promise.all([
        refreshClients(),
        refreshLeads(),
        refreshPortals(),
        refreshTrainings(),
        refreshAppointments(),
        refreshTasks(),
        refreshDevelopments(),
        refreshTeams(),
        refreshGoals(),
        refreshAnnouncements(),
        refreshProfiles(),
        refreshDirectorates(),
      ]);
    } finally {
      // loading controla somente a inicialização de sessão/tela protegida.
      // Atualizações em background não devem desmontar a UI inteira.
      setLoading(false);
    }
  }, [refreshClients, refreshLeads, refreshAppointments, refreshTasks, refreshDevelopments, refreshTeams, refreshGoals, refreshAnnouncements, refreshProfiles, refreshDirectorates]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).then(profileData => {
          loadAllData(profileData || undefined);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      // TOKEN_REFRESHED: apenas atualiza tokens, não recarrega dados
      // (evita setLoading(true) que desmontaria componentes em uso)
      if (event === 'TOKEN_REFRESHED') return;

      if (session?.user) {
        fetchProfile(session.user.id).then(profileData => {
          loadAllData(profileData || undefined);
        });
      } else {
        setProfile(null); setClients([]); setLeads([]);
        setAppointments([]); setTasks([]); setDevelopments([]);
        setTeams([]); setGoals([]); setAnnouncements([]);
        setLoading(false);
      }
    });

    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => refreshClients())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_proponents' }, () => refreshClients())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => refreshLeads())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => refreshAppointments())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refreshTasks())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'developments' }, () => refreshDevelopments())
      .subscribe();

    return () => {
      subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []); // ← dependências vazias: roda só na montagem, sem loop

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AppContext.Provider value={{
      session, user, profile, allProfiles, userName, userRole,
      signOut, refreshProfiles, updateProfile,
      clients, loading, addClient, updateClient, deleteClient, getClient, refreshClients,
      addClientProponent, updateClientProponent, deleteClientProponent,
      leads, refreshLeads, updateLead, convertLeadToClient,
      uploadFile,
      addDocumentToClient,
      deleteDocumentFromClient,
      renameClientDocument,
      getDownloadUrl,
      appointments, refreshAppointments, addAppointment, updateAppointment, deleteAppointment,
      tasks, refreshTasks, addTask, updateTask, deleteTask,
      developments, refreshDevelopments, addDevelopment, updateDevelopment, deleteDevelopment,
      teams, refreshTeams, addTeam, updateTeam, deleteTeam,
      goals, refreshGoals, addGoal, updateGoal, deleteGoal,
      announcements, refreshAnnouncements, addAnnouncement, updateAnnouncement, deleteAnnouncement,
      directorates, refreshDirectorates,
      addDirectorate,
      updateDirectorate,
      deleteDirectorate,
      portals,
      refreshPortals,
      addPortal,
      updatePortal,
      deletePortal,
      trainings,
      refreshTrainings,
      addTraining,
      updateTraining,
      deleteTraining,
      completeTraining,
    }}>
      {children}
    </AppContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
