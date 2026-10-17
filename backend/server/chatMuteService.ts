import * as chatMeta from './chatMetaRepository.js';

export interface ChatMuteSettingsDto {
  muteAll: boolean;
  mutedDirect: string[];
  mutedGroups: string[];
}

export async function getChatMuteSettings(userId: string): Promise<ChatMuteSettingsDto> {
  const rows = await chatMeta.listMutesForUser(userId);
  const mutedDirect: string[] = [];
  const mutedGroups: string[] = [];
  let muteAll = false;

  for (const r of rows) {
    const scope = String(r.scope || '');
    const targetId = r.targetId ? String(r.targetId) : null;
    if (scope === 'all') muteAll = true;
    else if (scope === 'direct' && targetId) mutedDirect.push(targetId);
    else if (scope === 'group' && targetId) mutedGroups.push(targetId);
  }

  return { muteAll, mutedDirect, mutedGroups };
}

export async function setMuteAll(userId: string, muted: boolean): Promise<void> {
  const existing = await chatMeta.findMute(userId, 'all', null);
  if (muted) {
    if (!existing) {
      await chatMeta.createMute({
        id: `cmute-all-${userId}`,
        userId,
        scope: 'all',
        targetId: null,
        createdAt: new Date().toISOString(),
      });
    }
  } else if (existing) {
    await chatMeta.deleteMute(existing.id);
  }
}

export async function setDirectMute(
  userId: string,
  partnerId: string,
  muted: boolean
): Promise<void> {
  const existing = await chatMeta.findMute(userId, 'direct', partnerId);
  if (muted) {
    if (!existing) {
      await chatMeta.createMute({
        id: `cmute-d-${userId}-${partnerId}`,
        userId,
        scope: 'direct',
        targetId: partnerId,
        createdAt: new Date().toISOString(),
      });
    }
  } else if (existing) {
    await chatMeta.deleteMute(existing.id);
  }
}

export async function setGroupMute(
  userId: string,
  groupId: string,
  muted: boolean
): Promise<void> {
  const existing = await chatMeta.findMute(userId, 'group', groupId);
  if (muted) {
    if (!existing) {
      await chatMeta.createMute({
        id: `cmute-g-${userId}-${groupId}`,
        userId,
        scope: 'group',
        targetId: groupId,
        createdAt: new Date().toISOString(),
      });
    }
  } else if (existing) {
    await chatMeta.deleteMute(existing.id);
  }
}
