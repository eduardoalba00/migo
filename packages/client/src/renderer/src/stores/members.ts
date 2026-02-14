import { create } from "zustand";
import type { ServerMember, UserStatus } from "@migo/shared";
import { SERVER_ROUTES, buildRoute } from "@migo/shared";
import { api } from "@/lib/api";

interface MemberState {
  members: ServerMember[];
  presenceMap: Record<string, UserStatus>;
  showSidebar: boolean;

  fetchMembers: (serverId: string) => Promise<void>;
  handlePresenceUpdate: (data: { userId: string; status: UserStatus }) => void;
  handleMemberJoin: (member: ServerMember) => void;
  handleMemberLeave: (data: { userId: string; serverId: string }) => void;
  toggleSidebar: () => void;
  clearMembers: () => void;
}

export const useMemberStore = create<MemberState>()((set) => ({
  members: [],
  presenceMap: {},
  showSidebar: true,

  fetchMembers: async (serverId) => {
    const members = await api.get<ServerMember[]>(
      buildRoute(SERVER_ROUTES.MEMBERS, { serverId }),
    );
    set({ members });
    // Initialize presence from member data
    const presenceMap: Record<string, UserStatus> = {};
    for (const m of members) {
      presenceMap[m.user.id] = m.user.status as UserStatus;
    }
    set((s) => ({ presenceMap: { ...s.presenceMap, ...presenceMap } }));
  },

  handlePresenceUpdate: (data) => {
    set((s) => ({
      presenceMap: { ...s.presenceMap, [data.userId]: data.status },
      members: s.members.map((m) =>
        m.user.id === data.userId
          ? { ...m, user: { ...m.user, status: data.status } }
          : m,
      ),
    }));
  },

  handleMemberJoin: (member) => {
    set((s) => {
      // Only update if this member belongs to the currently loaded server
      if (s.members.length === 0 || s.members[0]?.serverId !== member.serverId) return s;
      // Avoid duplicates
      if (s.members.some((m) => m.userId === member.userId)) return s;
      return {
        members: [...s.members, member],
        presenceMap: { ...s.presenceMap, [member.user.id]: member.user.status as UserStatus },
      };
    });
  },

  handleMemberLeave: (data) => {
    set((s) => {
      // Only update if the event matches the currently loaded server
      if (s.members.length === 0 || s.members[0]?.serverId !== data.serverId) return s;
      return {
        members: s.members.filter((m) => m.userId !== data.userId),
      };
    });
  },

  toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar })),

  clearMembers: () => set({ members: [], presenceMap: {} }),
}));
