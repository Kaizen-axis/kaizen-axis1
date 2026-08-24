import { Team } from '@/context/AppContext';

const normalizeTeamRef = (value?: string | null) => String(value || '').trim().toLowerCase();

export function isActiveProfile(profile: { status?: string | null }): boolean {
  const status = String(profile.status || '').trim().toLowerCase();
  return status === 'active' || status === 'ativo';
}

export function profileMatchesTeam(profile: { team?: string; team_id?: string | null }, team: Team): boolean {
  if (profile.team_id === team.id || profile.team === team.id) return true;
  const profileTeamName = normalizeTeamRef(profile.team);
  const teamName = normalizeTeamRef(team.name);
  return profileTeamName.length > 0 && profileTeamName === teamName;
}

export function getTeamMemberIds(team: Team, profiles: Array<{
  id: string;
  role?: string;
  status?: string | null;
  team?: string;
  team_id?: string | null;
  manager_id?: string | null;
  coordinator_id?: string | null;
}>): string[] {
  const active = profiles.filter(isActiveProfile);
  const onTeam = active.filter((p) => profileMatchesTeam(p, team) || p.id === team.manager_id);
  return Array.from(new Set(onTeam.map((p) => p.id)));
}
